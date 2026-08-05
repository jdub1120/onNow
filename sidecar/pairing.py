import logging
import secrets

from pyatv import pair, scan
from pyatv.const import Protocol

log = logging.getLogger("appletv_sidecar.pairing")

PROTOCOL_BY_NAME = {"companion": Protocol.Companion, "airplay": Protocol.AirPlay}


class PairingManager:
    """Owns in-flight pairing sessions.

    Pairing state (the SRP handshake) lives entirely in memory inside the
    pyatv PairingHandler instance for the duration of a session, so begin()
    and finish() must run in this same long-lived process.
    """

    def __init__(self, loop):
        self.loop = loop
        self.sessions = {}

    async def start(self, identifier, address, protocol_name):
        proto = PROTOCOL_BY_NAME.get(protocol_name)
        if proto is None:
            return None, f"Unknown protocol: {protocol_name}"

        atvs = await scan(self.loop, hosts=[address], identifier=identifier)
        if not atvs:
            return None, "Device not found on network"

        conf = atvs[0]
        pairing = await pair(conf, proto, self.loop)
        await pairing.begin()

        session_id = secrets.token_hex(16)
        self.sessions[session_id] = {"pairing": pairing, "protocol": protocol_name}
        log.info("Pairing started: session=%s protocol=%s identifier=%s", session_id, protocol_name, identifier)
        return session_id, None

    async def submit_pin(self, session_id, pin):
        session = self.sessions.get(session_id)
        if not session:
            return {"ok": False, "error": "Unknown or expired pairing session"}

        pairing = session["pairing"]
        pairing.pin(str(pin))
        try:
            await pairing.finish()
        except Exception as e:
            log.warning("Pairing finish failed: session=%s error=%s", session_id, e)
            await self._cleanup(session_id)
            return {"ok": False, "error": str(e)}

        if not pairing.has_paired:
            await self._cleanup(session_id)
            return {"ok": False, "error": "Pairing did not complete"}

        result = {"ok": True, "protocol": session["protocol"], "credentials": pairing.service.credentials}
        await self._cleanup(session_id)
        return result

    async def cancel(self, session_id):
        await self._cleanup(session_id)

    async def _cleanup(self, session_id):
        session = self.sessions.pop(session_id, None)
        if session:
            try:
                await session["pairing"].close()
            except Exception:
                pass
