const fs = require("fs");
const path = require("path");
const { CONFIG_ROOT } = require("./appPaths");

const DEVICES_FILE = path.join(CONFIG_ROOT, "appletv-devices.json");

/**
 * Kept separate from settings.json/the Settings class: that store does whole-file
 * field-by-field scalar rewrites and was never designed for a list of records
 * containing pairing credentials.
 */
function readStore() {
  if (!fs.existsSync(DEVICES_FILE)) return { devices: [] };
  try {
    const data = JSON.parse(fs.readFileSync(DEVICES_FILE, "utf-8"));
    if (!Array.isArray(data.devices)) return { devices: [] };
    return data;
  } catch (e) {
    return { devices: [] };
  }
}

function writeStore(store) {
  fs.writeFileSync(DEVICES_FILE, JSON.stringify(store, null, 4));
}

async function listDevices() {
  return readStore().devices;
}

async function listEnabledDevices() {
  return readStore().devices.filter((d) => d.enabled !== false);
}

async function getDevice(identifier) {
  return readStore().devices.find((d) => d.identifier === identifier) || null;
}

async function addOrUpdateDevice({ identifier, name, address, credentials }) {
  const store = readStore();
  const existing = store.devices.find((d) => d.identifier === identifier);
  const now = new Date().toISOString();

  if (existing) {
    existing.name = name || existing.name;
    existing.address = address || existing.address;
    existing.credentials = Object.assign({}, existing.credentials, credentials || {});
    existing.pairedAt = existing.pairedAt || now;
  } else {
    store.devices.push({
      identifier,
      name: name || identifier,
      address,
      credentials: credentials || {},
      enabled: true,
      pairedAt: now,
      lastSeenAt: null,
      lastSeenReachable: false,
    });
  }
  writeStore(store);
  return getDevice(identifier);
}

async function removeDevice(identifier) {
  const store = readStore();
  store.devices = store.devices.filter((d) => d.identifier !== identifier);
  writeStore(store);
}

async function setDeviceEnabled(identifier, enabled) {
  const store = readStore();
  const existing = store.devices.find((d) => d.identifier === identifier);
  if (!existing) return null;
  existing.enabled = !!enabled;
  writeStore(store);
  return existing;
}

async function markDeviceSeen(identifier, reachable) {
  const store = readStore();
  const existing = store.devices.find((d) => d.identifier === identifier);
  if (!existing) return;
  existing.lastSeenAt = new Date().toISOString();
  existing.lastSeenReachable = !!reachable;
  writeStore(store);
}

module.exports = {
  listDevices,
  listEnabledDevices,
  getDevice,
  addOrUpdateDevice,
  removeDevice,
  setDeviceEnabled,
  markDeviceSeen,
};
