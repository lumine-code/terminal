// State shared by the lightweight package entrypoint and the terminal view.
// Keeping this outside `element.js` means a service can provide the bridge
// before any xterm code has been loaded.
let mcpBridge = null;
let autoShellPromise = Promise.resolve();

function getMcpBridge() {
  return mcpBridge;
}

function setMcpBridge(value) {
  mcpBridge = value;
}

function getAutoShellPromise() {
  return autoShellPromise;
}

function setAutoShellPromise(value) {
  autoShellPromise = value ?? Promise.resolve();
}

module.exports = {
  getAutoShellPromise,
  getMcpBridge,
  setAutoShellPromise,
  setMcpBridge,
};
