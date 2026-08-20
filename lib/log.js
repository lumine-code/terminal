const TAG = `[terminal] `;

let enabled = false;
let subscription = undefined;

function initialize() {
  if (subscription) return;
  subscription = lumine.config.observe("terminal.advanced.enableDebugLogging", (newValue) => {
    enabled = newValue;
  });
}

function destroy() {
  subscription?.dispose();
  subscription = undefined;
}

function log(...args) {
  if (!enabled) return;
  args.unshift(TAG);
  console.log(...args);
}

function warn(...args) {
  if (!enabled) return;
  args.unshift(TAG);
  console.warn(...args);
}

function debug(...args) {
  if (!enabled) return;
  args.unshift(TAG);
  console.debug(...args);
}

function error(...args) {
  if (!enabled) return;
  args.unshift(TAG);
  console.error(...args);
}

module.exports = { initialize, destroy, log, warn, debug, error };
