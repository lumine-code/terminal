// Manages the creation and destruction of a PTY.
//
// This is moderated through a worker process that runs in a Node-only
// environment so that `node-pty` can run properly.

const path = require("path");
const { CompositeDisposable, Emitter } = require("atom");
const ndjson = require("ndjson");
const { spawn } = require("child_process");

const { Config } = require("./config");
const { isWindows, timeout } = require("./utils");

const WORKER_PATH = path.join(__dirname, "pty-worker.js");

function isError(thing) {
  return thing instanceof Error;
}

const PtyState = Object.freeze({
  // We have spawned the worker but have not heard back from it yet.
  CREATED: 0,
  // The worker says it's ready for messages, but we don't know if the initial
  // command succeeded.
  BOOTED: 1,
  // The initial command succeeded, so we can expect to send/receive data.
  READY: 2,
});

let uid = 0;

class Pty {
  readyState = PtyState.CREATED;
  destroyed = false;
  subscriptions = new CompositeDisposable();

  process = null;
  emitter = new Emitter();

  error = false;

  // Metadata about the PTY session.
  meta = {};

  get title() {
    return this.meta.title ?? undefined;
  }

  get cols() {
    return this.meta.cols ?? undefined;
  }

  get rows() {
    return this.meta.rows ?? undefined;
  }

  get pid() {
    return this.meta.pid ?? undefined;
  }

  constructor(options) {
    this.options = options;
    this.id = uid++;
    this.start();
  }

  onDidChangeReadyState(callback) {
    return this.emitter.on("did-change-ready-state", callback);
  }

  onData(callback) {
    return this.emitter.on("data", callback);
  }

  onError(callback) {
    return this.emitter.on("error", callback);
  }

  onStderr(callback) {
    return this.emitter.on("sterr", callback);
  }

  onExit(callback) {
    return this.emitter.on("exit", callback);
  }

  changeReadyState(newState) {
    this.readyState = newState;
    this.emitter.emit("did-change-ready-state", newState);
  }

  async start() {
    let options = {};

    options.env ??= Object.create(process.env);
    options.env.ELECTRON_RUN_AS_NODE = "1";
    options.env.ELECTRON_NO_ATTACH_CONSOLE = "1";

    let args = [];
    args.unshift(WORKER_PATH);
    args.unshift("--no-deprecation");

    this.error = false;
    this.process = this.spawn(process.execPath, args, options);

    this.process.stdout.pipe(ndjson.parse({ strict: false })).on("data", (obj) => {
      if (this.destroyed) return;
      switch (obj.type) {
        case "ready":
          if (this.readyState < PtyState.BOOTED) {
            this.changeReadyState(PtyState.BOOTED);
          }
          if (this.readyState > PtyState.BOOTED) {
            console.warn(`[Terminal] Warning: PTY in weird state (ready before booting?)`);
          }
          break;
        case "data":
          if (this.readyState !== PtyState.READY) {
            this.changeReadyState(PtyState.READY);
          }
          if (obj.meta) {
            Object.assign(this.meta, obj.meta);
          }
          this.emitter.emit("data", obj.payload);
          break;
        case "exit":
          this.emitter.emit("exit", obj.payload.exitCode);
          break;
        case "meta":
          Object.assign(this.meta, obj.payload);
          break;
        case "log":
          if (Config.get("advanced.enableDebugLogging")) {
            console.log("[Terminal] [Worker]", obj.payload);
          }
          break;
        default:
        // Do nothing
      }
    });

    this.process.stderr.pipe(ndjson.parse({ strict: false })).on("data", (obj) => {
      if (obj.type !== "stderr") return;
      this.emitter.emit("stderr", obj.payload);
    });

    this.process.on("error", (err) => {
      console.error("[Terminal] Error from PTY:", err);
      this.error = true;
      // These will be no-ops if their associated promises have already
      // resolved.
      this.emitter.emit("error", err);
      this.kill();
    });

    let bootedPromise = this.booted();

    await timeout(bootedPromise, 5000, { tag: "Booted" });
    if (this.destroyed) return;

    if (!this.process.stdin) {
      let error = new Error("Failed to spawn PTY");
      this.emitError(error);
    }

    // If we get this far, the PTY is ready to receive the initial command.
    let spawnMessage = {
      type: "spawn",
      payload: this.options,
    };
    this.#sendMessage(spawnMessage);

    let firstDataPromise = this.ready();

    // We should not consider this process to have spawned successfully until
    // it sends us data without sending any errors.
    await timeout(firstDataPromise, 5000, { tag: "Ready" });
  }

  emitError(err) {
    if (this.destroyed) return;
    let error;
    if (isError(err)) {
      error = err;
    } else if (typeof err === "string") {
      error = new Error(err);
    } else {
      error = new Error(`Unknown error`);
    }
    this.emitter.emit("error", error);
    throw error;
  }

  kill(signal) {
    if (isWindows()) {
      this.#killOnWindows();
    } else {
      this.#killProcess(signal);
    }
    this.destroy();
  }

  forceKill() {
    this.process?.kill("SIGKILL");
  }

  write(data) {
    let message = {
      type: "write",
      payload: data,
    };

    this.#sendMessage(message);
  }

  destroy() {
    this.destroyed = true;
    this.subscriptions.dispose();
  }

  removeAllListeners(eventType) {
    let message = {
      type: "removeAllListeners",
      payload: eventType,
    };
    this.#sendMessage(message);
  }

  spawn(command, args, options) {
    return spawn(command, args, options);
  }

  #sendMessage(message) {
    if (!this.process?.stdin) return;
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #killProcess(signal) {
    // We don't distinguish between killing and graceful exit. That distinction
    // seems not to exist in `node-pty`, nor in VS Code’s terminal.
    let message = {
      type: "kill",
      payload: {},
    };
    if (!isWindows() && signal) {
      message.payload.signal = signal;
    }
    this.#sendMessage(message);
  }

  #killOnWindows() {
    if (!this.process) return;
    if (!isWindows()) return;

    let parentPid = this.process.pid;
    let cmd = "wmic";
    const args = ["process", "where", `(ParentProcessId=${parentPid})`, "get", "processid"];

    let wmicProcess;
    try {
      wmicProcess = spawn(cmd, args);
    } catch {
      this.#killProcess();
      return;
    }
    if (!wmicProcess.stdout) {
      this.#killProcess();
      return;
    }

    wmicProcess.on("error", () => {});

    let output = "";
    wmicProcess.stdout.on("data", (data) => (output += data));
    wmicProcess.stdout.on("close", () => {
      for (let rawPid of output.split(/\s+/)) {
        if (!/^\d{1,10}$/.test(rawPid)) continue;
        let pid = parseInt(rawPid, 10);

        if (!pid || pid === parentPid) continue;

        try {
          process.kill(pid);
        } catch {
          // The process may already be gone; ignore.
        }
      }
    });

    this.#killProcess();
  }

  async #waitForReadyState(readyState) {
    if (this.readyState >= readyState) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let disposables = new CompositeDisposable();
      disposables.add(
        this.onDidChangeReadyState((newState) => {
          if (newState >= readyState) {
            disposables.dispose();
            return resolve();
          }
        }),

        this.onError((err) => {
          disposables.dispose();
          return reject(err);
        }),
      );
      this.subscriptions.add(disposables);
    });
  }

  async booted() {
    return await this.#waitForReadyState(PtyState.BOOTED);
  }

  async ready() {
    return await this.#waitForReadyState(PtyState.READY);
  }

  pause() {
    this.#sendMessage({
      type: "pause",
      payload: null,
    });
  }

  resume() {
    this.#sendMessage({
      type: "resume",
      payload: null,
    });
  }

  clear() {
    this.#sendMessage({
      type: "clear",
      payload: null,
    });
  }

  resize(cols, rows) {
    this.#sendMessage({
      type: "resize",
      payload: [cols, rows],
    });
  }
}

module.exports = { Pty };
