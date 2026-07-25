const os = require("os");

const config = require("./config");

function isWindows() {
  return process.platform === "win32";
}

function isMac() {
  return process.platform === "darwin";
}

function isLinux() {
  return process.platform === "linux";
}

function willUseConPTY() {
  // According to `node-pty`’s documentation, ConPTY will be used when the user
  // is on Windows 10 (1809) or greater, which corresponds to build 17763.
  if (!isWindows()) return false;
  return (windowsBuildNumber() ?? 0) >= 17763;
}

function windowsBuildNumber() {
  if (!isWindows()) return undefined;
  let versionSegments = os.release().split(".");
  let buildNumber = parseInt(versionSegments[versionSegments.length - 1], 10);
  return buildNumber;
}

const BASE_URI = `terminal://`;
const PACKAGE_NAME = "terminal";

function withResolvers() {
  let resolve;
  let reject;

  let promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve: resolve, reject: reject };
}

function recalculateActive(terminals, active) {
  let allowHidden = config.Config.get("behavior.activeTerminalLogic") === "all";
  let terminalsList = Array.from(terminals);
  terminalsList.sort((a, b) => {
    if (active && a === active) return -1;
    if (active && b === active) return 1;

    if (!allowHidden) {
      if (a.isVisible() && !b.isVisible()) return -1;
      if (b.isVisible() && !a.isVisible()) return 1;
    }

    return a.activeIndex - b.activeIndex;
  });

  for (let [index, term] of terminalsList.entries()) {
    term.setIndex(index);
  }
}

async function timeout(promise, timeoutMs = 5000, { tag = "" } = {}) {
  let rejectPromise = new Promise((_, reject) => {
    setTimeout(
      reject,
      timeoutMs,
      new Error(`${tag}: Failed to resolve after ${timeoutMs} milliseconds`),
    );
  });
  return Promise.race([promise, rejectPromise]);
}

function debounce(callback, waitMs = 300) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), waitMs);
  };
}

// Collapse a burst of calls into a single one on the next microtask.
//
// Unlike `debounce`, the callback still runs within the task that scheduled it,
// so its DOM writes land before the browser's next rendering opportunity. That
// matters for the theme: Lumine swaps stylesheets inside a View Transition,
// which snapshots the whole window — canvases included — one frame after the
// swap. A `debounce` here repaints the terminal long after the cross-fade has
// finished, which reads as the terminal popping to its new colors on its own.
function coalesce(callback) {
  let scheduled = false;
  return (...args) => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      callback(...args);
    });
  };
}

function generateUri(params = {}) {
  let url = new URL(`${BASE_URI}${crypto.randomUUID()}/`);
  for (let [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function parseEnvConfigValue(rawJson) {
  let result;
  try {
    result = JSON.parse(rawJson);
    return result;
  } catch {
    return {};
  }
}

// Assign onto the existing `module.exports` object (rather than replacing it)
// so the reference captured by `./config` during the config↔utils require
// cycle stays valid.
Object.assign(module.exports, {
  isWindows,
  isMac,
  isLinux,
  willUseConPTY,
  windowsBuildNumber,
  BASE_URI,
  PACKAGE_NAME,
  withResolvers,
  recalculateActive,
  timeout,
  debounce,
  coalesce,
  generateUri,
  parseEnvConfigValue,
});
