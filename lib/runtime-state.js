// State shared by the lightweight package entrypoint and the terminal view.
// Keeping this outside `element.js` means services can be consumed before any
// xterm code has been loaded.
// A registered native constructor keeps its original module closures after a
// package reload. Share these lightweight values for the document lifetime so
// that constructor observes the current entrypoint's services and shell task.
const host = typeof document === "undefined" ? globalThis : document;
const key = Symbol.for("lumine.terminal.runtime-state");
const state = (host[key] ??= {
  mcpBridge: null,
  openExternal: null,
  autoShellPromise: Promise.resolve(),
});

function getMcpBridge() {
  return state.mcpBridge;
}

function setMcpBridge(value) {
  state.mcpBridge = value;
}

function getOpenExternal() {
  return state.openExternal;
}

function setOpenExternal(value) {
  state.openExternal = value;
}

function getAutoShellPromise() {
  return state.autoShellPromise;
}

function setAutoShellPromise(value) {
  state.autoShellPromise = value ?? Promise.resolve();
}

module.exports = {
  getAutoShellPromise,
  getMcpBridge,
  getOpenExternal,
  setAutoShellPromise,
  setMcpBridge,
  setOpenExternal,
};
