// State shared by the lightweight package entrypoint and the terminal view.
// Keeping this outside `element.js` means services can be consumed before any
// xterm code has been loaded.
let mcpBridge = null;
let openExternal = null;
let autoShellPromise = Promise.resolve();

function getMcpBridge() {
  return mcpBridge;
}

function setMcpBridge(value) {
  mcpBridge = value;
}

function getOpenExternal() {
  return openExternal;
}

function setOpenExternal(value) {
  openExternal = value;
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
  getOpenExternal,
  setAutoShellPromise,
  setMcpBridge,
  setOpenExternal,
};
