// State shared by the lightweight package entrypoint and the terminal view.
// Keeping this outside `element.js` means services can be consumed before any
// xterm code has been loaded.
// A registered native constructor keeps its original module closures after a
// package reload. Share these lightweight values for the document lifetime so
// that constructor observes the current entrypoint's services.
const host = typeof document === "undefined" ? globalThis : document;
const key = Symbol.for("lumine.terminal.runtime-state");
const state = (host[key] ??= {
  mcpBridge: null,
  openExternal: null,
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

module.exports = {
  getMcpBridge,
  getOpenExternal,
  setMcpBridge,
  setOpenExternal,
};
