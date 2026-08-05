import argparse
import asyncio
import importlib.metadata
import logging
import time

from aiohttp import web

from device_manager import DeviceManager, discover
from pairing import PairingManager

PYATV_VERSION = importlib.metadata.version("pyatv")

log = logging.getLogger("appletv_sidecar")

START_TIME = time.monotonic()


def make_app(loop):
    device_manager = DeviceManager(loop)
    pairing_manager = PairingManager(loop)

    app = web.Application()
    app["device_manager"] = device_manager
    app["pairing_manager"] = pairing_manager

    async def health(request):
        return web.json_response({
            "status": "ok",
            "pyatvVersion": PYATV_VERSION,
            "uptimeSec": round(time.monotonic() - START_TIME),
            "connectedDeviceCount": sum(1 for d in device_manager.devices.values() if d.reachable),
        })

    async def discover_handler(request):
        timeout = int(request.query.get("timeout", 5))
        devices = await discover(loop, timeout=timeout)
        return web.json_response({"devices": devices})

    async def pairing_start(request):
        body = await request.json()
        session_id, error = await pairing_manager.start(body["identifier"], body["address"], body["protocol"])
        if error:
            return web.json_response({"ok": False, "error": error}, status=400)
        return web.json_response({"pairingSessionId": session_id, "status": "awaiting_pin"})

    async def pairing_pin(request):
        body = await request.json()
        result = await pairing_manager.submit_pin(body["pairingSessionId"], body["pin"])
        return web.json_response(result, status=200 if result.get("ok") else 400)

    async def pairing_cancel(request):
        body = await request.json()
        await pairing_manager.cancel(body["pairingSessionId"])
        return web.json_response({"ok": True})

    async def devices_sync(request):
        body = await request.json()
        result = await device_manager.sync(body.get("devices", []))
        return web.json_response(result)

    async def now_playing(request):
        devices = await device_manager.now_playing()
        return web.json_response({"devices": devices})

    async def artwork(request):
        identifier = request.match_info["identifier"]
        result = await device_manager.artwork(identifier)
        if not result:
            return web.Response(status=404)
        image_bytes, mimetype = result
        return web.Response(body=image_bytes, content_type=mimetype)

    async def on_cleanup(app):
        await device_manager.close_all()

    app.router.add_get("/health", health)
    app.router.add_get("/discover", discover_handler)
    app.router.add_post("/pairing/start", pairing_start)
    app.router.add_post("/pairing/pin", pairing_pin)
    app.router.add_post("/pairing/cancel", pairing_cancel)
    app.router.add_post("/devices/sync", devices_sync)
    app.router.add_get("/now-playing", now_playing)
    app.router.add_get("/artwork/{identifier}", artwork)
    app.on_cleanup.append(on_cleanup)
    return app


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3011)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="[appletv-sidecar] %(asctime)s %(levelname)s %(message)s")

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    app = make_app(loop)
    web.run_app(app, host=args.host, port=args.port, loop=loop, print=None)


if __name__ == "__main__":
    main()
