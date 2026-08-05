import asyncio
import logging
from dataclasses import dataclass, field

from pyatv import connect, scan
from pyatv.const import Protocol

log = logging.getLogger("appletv_sidecar.devices")

REQUIRED_PROTOCOLS = ("companion", "airplay")


@dataclass
class DeviceEntry:
    identifier: str
    name: str
    address: str
    credentials: dict = field(default_factory=dict)
    atv: object = None
    reachable: bool = False
    last_error: str = None
    artwork_hash: str = None
    artwork_bytes: bytes = None
    artwork_mimetype: str = None


class DeviceManager:
    def __init__(self, loop):
        self.loop = loop
        self.devices = {}
        self._lock = asyncio.Lock()

    async def sync(self, device_list):
        """Reconcile the in-memory connection pool against the desired device list."""
        async with self._lock:
            incoming_ids = {d["identifier"] for d in device_list}
            for identifier in list(self.devices.keys()):
                if identifier not in incoming_ids:
                    await self._disconnect(identifier)

            result = {"connected": [], "connecting": [], "failed": []}
            for d in device_list:
                identifier = d["identifier"]
                creds = d.get("credentials") or {}
                existing = self.devices.get(identifier)

                if existing and existing.credentials == creds and existing.atv is not None:
                    result["connected"].append(identifier)
                    continue

                if existing and existing.atv is not None:
                    await self._disconnect(identifier)

                entry = DeviceEntry(
                    identifier=identifier,
                    name=d.get("name") or identifier,
                    address=d["address"],
                    credentials=creds,
                )
                self.devices[identifier] = entry
                ok, err = await self._connect(entry)
                if ok:
                    result["connected"].append(identifier)
                else:
                    result["failed"].append({"identifier": identifier, "error": err})
            return result

    async def _connect(self, entry: DeviceEntry):
        missing = [p for p in REQUIRED_PROTOCOLS if not entry.credentials.get(p)]
        if missing:
            entry.reachable = False
            entry.last_error = f"Missing credentials for: {', '.join(missing)}"
            return False, entry.last_error

        try:
            atvs = await scan(self.loop, hosts=[entry.address], identifier=entry.identifier)
            if not atvs:
                entry.reachable = False
                entry.last_error = "Device not found on network"
                return False, entry.last_error

            conf = atvs[0]
            conf.set_credentials(Protocol.Companion, entry.credentials["companion"])
            conf.set_credentials(Protocol.AirPlay, entry.credentials["airplay"])
            entry.atv = await connect(conf, self.loop)
            entry.reachable = True
            entry.last_error = None
            return True, None
        except Exception as e:
            entry.reachable = False
            entry.last_error = str(e)
            return False, str(e)

    async def _disconnect(self, identifier):
        entry = self.devices.pop(identifier, None)
        if entry and entry.atv is not None:
            try:
                entry.atv.close()
            except Exception:
                pass

    async def now_playing(self):
        async with self._lock:
            entries = list(self.devices.values())

        out = []
        for entry in entries:
            item = {
                "identifier": entry.identifier,
                "name": entry.name,
                "address": entry.address,
                "reachable": False,
                "appId": None,
                "appName": None,
                "state": None,
            }

            if entry.atv is None:
                await self._connect(entry)
            if entry.atv is None:
                item["reachable"] = False
                out.append(item)
                continue

            try:
                playing = await entry.atv.metadata.playing()
                try:
                    app = entry.atv.metadata.app
                except Exception:
                    app = None

                item["reachable"] = True
                item["appId"] = app.identifier if app else None
                item["appName"] = app.name if app else None

                # Fetch+cache artwork once per content change (keyed by pyatv's own content hash)
                # so /artwork serves from memory instead of a second live fetch, and hasArtwork
                # accurately reflects what /artwork can actually return.
                if playing.hash != entry.artwork_hash:
                    entry.artwork_hash = playing.hash
                    entry.artwork_bytes = None
                    entry.artwork_mimetype = None
                    try:
                        art = await entry.atv.metadata.artwork()
                        if art:
                            entry.artwork_bytes = art.bytes
                            entry.artwork_mimetype = art.mimetype or "image/jpeg"
                    except Exception:
                        pass

                item["state"] = {
                    "deviceState": playing.device_state.name,
                    "mediaType": playing.media_type.name,
                    "title": playing.title,
                    "artist": playing.artist,
                    "album": playing.album,
                    "seriesName": playing.series_name,
                    "seasonNumber": playing.season_number,
                    "episodeNumber": playing.episode_number,
                    "position": playing.position,
                    "totalTime": playing.total_time,
                    "hash": playing.hash,
                    "hasArtwork": entry.artwork_bytes is not None,
                }
                entry.reachable = True
                entry.last_error = None
            except Exception as e:
                log.warning("now_playing poll failed for %s: %s", entry.identifier, e)
                entry.reachable = False
                entry.last_error = str(e)
                try:
                    entry.atv.close()
                except Exception:
                    pass
                entry.atv = None
                item["reachable"] = False

            out.append(item)
        return out

    async def artwork(self, identifier):
        entry = self.devices.get(identifier)
        if not entry or entry.artwork_bytes is None:
            return None
        return entry.artwork_bytes, entry.artwork_mimetype or "image/jpeg"

    async def close_all(self):
        async with self._lock:
            identifiers = list(self.devices.keys())
        for identifier in identifiers:
            await self._disconnect(identifier)


async def discover(loop, timeout=5):
    atvs = await scan(loop, timeout=timeout)
    out = []
    for conf in atvs:
        services = [{"protocol": svc.protocol.name.lower(), "port": svc.port} for svc in conf.services]
        out.append({
            "identifier": conf.identifier,
            "name": conf.name,
            "address": str(conf.address),
            "model": str(conf.device_info) if conf.device_info else None,
            "services": services,
        })
    return out
