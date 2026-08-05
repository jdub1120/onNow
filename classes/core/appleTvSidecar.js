const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

const SIDECAR_SCRIPT = path.join(process.cwd(), "sidecar", "appletv_sidecar.py");

let child = null;
let port = 3011;
let lastHealthOk = false;
let restartAttempts = 0;
let restartWindowStart = Date.now();
let restartTimer = null;
let stopped = true;

const MAX_RESTARTS_PER_WINDOW = 5;
const RESTART_WINDOW_MS = 2 * 60 * 1000;

function resolvePythonBin() {
  if (process.env.POSTERR_APPLETV_PYTHON) return process.env.POSTERR_APPLETV_PYTHON;
  return process.platform === "win32" ? "python" : "python3";
}

function baseUrl() {
  return `http://127.0.0.1:${port}`;
}

function isRunning() {
  return child !== null && !child.killed;
}

function isAvailable() {
  return isRunning() && lastHealthOk;
}

function scheduleRestart() {
  if (stopped) return;

  const now = Date.now();
  if (now - restartWindowStart > RESTART_WINDOW_MS) {
    restartWindowStart = now;
    restartAttempts = 0;
  }
  restartAttempts++;

  if (restartAttempts > MAX_RESTARTS_PER_WINDOW) {
    console.log(
      "[appletv-sidecar] disabled after repeated crashes — check python3/pyatv install (POSTERR_APPLETV_PYTHON to override interpreter path)"
    );
    return;
  }

  const backoffMs = Math.min(30000, 1000 * Math.pow(2, restartAttempts - 1));
  restartTimer = setTimeout(() => spawnProcess(), backoffMs);
}

function spawnProcess() {
  if (stopped) return;
  if (!fs.existsSync(SIDECAR_SCRIPT)) {
    console.log("[appletv-sidecar] sidecar script not found at " + SIDECAR_SCRIPT);
    return;
  }

  const pythonBin = resolvePythonBin();
  child = spawn(pythonBin, [SIDECAR_SCRIPT, "--port", String(port), "--host", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (d) => process.stdout.write(`[appletv-sidecar] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[appletv-sidecar] ${d}`));

  child.on("error", (err) => {
    console.log("[appletv-sidecar] failed to start: " + err.message);
    child = null;
    scheduleRestart();
  });

  child.on("exit", (code, signal) => {
    const wasStopped = stopped;
    child = null;
    lastHealthOk = false;
    if (!wasStopped) {
      console.log(`[appletv-sidecar] exited unexpectedly (code=${code}, signal=${signal}), restarting...`);
      scheduleRestart();
    }
  });
}

async function ensureRunning(opts) {
  if (opts && opts.port) port = opts.port;
  if (!isRunning()) {
    stopped = false;
    restartAttempts = 0;
    restartWindowStart = Date.now();
    spawnProcess();
  }

  // wait for the aiohttp server to actually accept connections before returning,
  // so an immediate syncDevices() call right after doesn't race a not-yet-listening process
  for (let i = 0; i < 20; i++) {
    if (await checkHealth()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
}

function stop() {
  stopped = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (child) {
    child.kill("SIGTERM");
    const c = child;
    setTimeout(() => {
      if (c && !c.killed) {
        try {
          c.kill("SIGKILL");
        } catch (e) {
          /* already gone */
        }
      }
    }, 3000);
    child = null;
  }
  lastHealthOk = false;
}

async function checkHealth() {
  try {
    await axios.get(baseUrl() + "/health", { timeout: 3000 });
    lastHealthOk = true;
  } catch (e) {
    lastHealthOk = false;
  }
  return lastHealthOk;
}

async function syncDevices(devices) {
  if (!isAvailable()) return null;
  try {
    const res = await axios.post(baseUrl() + "/devices/sync", { devices }, { timeout: 15000 });
    return res.data;
  } catch (e) {
    return null;
  }
}

module.exports = {
  ensureRunning,
  stop,
  isRunning,
  isAvailable,
  checkHealth,
  syncDevices,
  baseUrl,
};
