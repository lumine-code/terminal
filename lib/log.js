const { Disposable } = require('atom');

const TAG = `[terminal] `;

let enabled = false;
let subscription = undefined;

function initialize () {
  subscription = atom.config.observe('terminal.advanced.enableDebugLogging', (newValue) => {
    enabled = newValue;
  });
}

function destroy () {
  subscription?.dispose();
}

function log (...args) {
  if (!enabled) return;
  args.unshift(TAG);
  console.log(...args);
}

function warn (...args) {
  if (!enabled) return;
  args.unshift(TAG);
  console.warn(...args);
}

function debug (...args) {
  if (!enabled) return;
  args.unshift(TAG);
  console.debug(...args);
}

function error (...args) {
  if (!enabled) return;
  args.unshift(TAG);
  console.debug(...args);
}

module.exports = { initialize, destroy, log, warn, debug, error };
