// A worker script for driving `node-pty`.
//
// `node-pty` expects to be able to use Node’s `worker_threads` library to get
// around an issue on Windows. That means we can’t consume it directly within
// Lumine's renderer process because of
// https://github.com/electron/electron/issues/18540#issuecomment-665752233.
//
// The workaround is to run a worker script via `ELECTRON_RUN_AS_NODE=1` to use
// `node-pty` in its own isolated Node process. Amazingly, this seems to work
// just fine even though we're running the renderer’s Node rather than the main
// process’s Node.
//
// One worker can drive any number of PTYs. Every message in either direction
// carries the `id` of the session it belongs to, so a single worker serves
// every terminal in the window — booting one costs a whole Node startup and
// about 100MB, and paying that per terminal is what made opening a second
// terminal as slow as opening the first.
//
// `@lumine-code/node-pty` is deliberately NOT a dependency of this package.
// Lumine ships it and re-exports it from its `exports/` folder, which is on
// `NODE_PATH`, so the `require` below resolves to the editor's copy. That keeps
// installing this package from compiling a native module, which is where such
// installs usually fail. It also means the worker must inherit `NODE_PATH` from
// the renderer — see `PtyHost.start` in `pty.js`.

const util = require("util");

util.inspect.defaultOptions.depth = null;

const { spawn } = require("@lumine-code/node-pty");
const ndjson = require("ndjson");

// Whether log messages get sent to the parent.
const DEBUG = false;

// Every live PTY, keyed by the session id the renderer assigned it.
const ptys = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function getMeta(id) {
  let pty = ptys.get(id);
  if (!pty) return undefined;
  // Whenever we send new text to the renderer process, we also send all PTY
  // metadata so that it can be updated on the wrapper object. This allows the
  // user to read the process title, the current row/column count, etc.,
  // without needing to turn those into async requests.
  return {
    title: pty.process,
    rows: pty.rows,
    cols: pty.cols,
    pid: pty.pid,
  };
}

function emit(id, payload) {
  send({ type: "data", id, payload, meta: getMeta(id) });
}

function emitError(id, payload) {
  send({ type: "error", id, payload });
}

function emitMeta(id) {
  send({ type: "meta", id, payload: getMeta(id) });
}

function emitReady() {
  send({ type: "ready", payload: null });
}

function emitExit(id, exitCode, signal) {
  send({ type: "exit", id, payload: { exitCode, signal } });
}

function log(obj) {
  if (!DEBUG) return;
  if (typeof obj !== "string") {
    obj = JSON.stringify(obj);
  }
  send({ type: "log", payload: obj });
}

function spawnPty(id, file, args, options) {
  let pty;
  try {
    pty = spawn(file, args, options);
  } catch (error) {
    // Older Lumine installations may contain a node-pty native addon that
    // supports useConptyDll but lost its companion DLL during Electron's
    // rebuild step. Keep their terminals usable until the corrected package
    // is installed; other launch failures must retain their original error.
    let missingBundledConpty =
      process.platform === "win32" &&
      options.useConptyDll &&
      /(?:Cannot find|Failed to load) conpty\.dll/.test(error.message ?? String(error));
    if (!missingBundledConpty) throw error;
    pty = spawn(file, args, { ...options, useConptyDll: false });
  }
  pty.onData((data) => emit(id, data));
  pty.onExit(({ exitCode, signal }) => {
    ptys.delete(id);
    emitExit(id, exitCode, signal);
  });
  ptys.set(id, pty);
  return pty;
}

async function processMessage(data) {
  let { id } = data;
  let pty = ptys.get(id);

  switch (data.type) {
    case "spawn": {
      // A session may only be spawned once. Spawning twice would leave two
      // shells writing into one terminal, and only one of them reachable.
      if (pty) {
        log(`Ignoring a second spawn for session ${id}`);
        return;
      }
      let argsDebug = Array.isArray(data.payload.args)
        ? data.payload.args.join(", ")
        : data.payload.args;
      log(`Spawning PTY with file: ${data.payload.file} and args: ${argsDebug}`);
      try {
        spawnPty(id, data.payload.file, data.payload.args, data.payload.options);
      } catch (error) {
        emitError(id, error.message ?? String(error));
      }
      break;
    }
    case "kill":
      if (!pty) return;
      ptys.delete(id);
      try {
        if (process.platform === "win32" || !data.payload.signal) {
          pty.kill();
        } else {
          pty.kill(data.payload.signal);
        }
      } catch {
        // The PTY may already be gone; that is the outcome we wanted anyway.
      }
      break;
    case "write":
      if (!pty) return;
      pty.write(data.payload);
      break;
    case "removeAllListeners":
      if (!pty) return;
      // Undocumented.
      pty.removeAllListeners(data.payload);
      break;
    case "resize": {
      if (!pty) return;
      let [cols, rows] = data.payload;
      pty.resize(cols, rows);
      emitMeta(id);
      break;
    }
    case "pause":
      if (!pty) return;
      pty.pause();
      emitMeta(id);
      break;
    case "resume":
      if (!pty) return;
      pty.resume();
      emitMeta(id);
      break;
    case "clear":
      if (!pty) return;
      pty.clear();
      emitMeta(id);
      break;
    default:
    // Do nothing.
  }
}

process.title = `node (Lumine terminal process ${process.pid})`;

// We'll communicate with the parent process via newline-delimited JSON
// messages. This lets us use a newline as a message delimiter without us
// getting confused when we encounter newlines in the data: if it's within a
// JSON message, it's not a message delimiter.
process.stdin.pipe(ndjson.parse()).on("data", processMessage);

// By listening to stdin here, we keep the process from exiting for as long as
// stdin exists.
process.stdin.resume();

process.on("uncaughtException", (error) => {
  // When errors happen, we should not try to recover, or do anything that
  // might produce a subsequent error. Instead, our only goal here is to try to
  // raise the visibility of the error and capture some diagnostic information
  // before exiting.
  error.uncaught = true;
  error.error = "Unknown error";

  try {
    process.stderr.write(
      `${JSON.stringify({
        type: "stderr",
        payload: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      })}\n`,
    );
  } finally {
    process.exit(1);
  }
});

log("Ready to go!");

emitReady();
