// Manages the creation and destruction of a PTY.
//
// This is moderated through a worker process that runs in a Node-only
// environment so that `node-pty` can run properly. A {PtyHost} owns that
// process; a {Pty} is one session on a host, and several sessions can share
// one. Booting a host costs a whole Node startup — about 100ms — and roughly
// 100MB of resident memory, so by default every terminal in the window shares
// the one host and only the first terminal pays for it.

const path = require("path");
const { CompositeDisposable, Emitter } = require("lumine");
const ndjson = require("ndjson");
const { spawn } = require("child_process");

const Logger = require("./log");
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

// The worker process, and the routing of messages to and from the sessions
// running on it. A host outlives any one terminal.
class PtyHost {
  static #shared = null;

  // The host every terminal uses unless it asked for one of its own. Booted on
  // first use and kept for the life of the window: a booted host is what makes
  // the second terminal open in a fraction of the time the first did.
  static shared() {
    if (!this.#shared || this.#shared.destroyed) {
      this.#shared = new PtyHost();
    }
    return this.#shared;
  }

  // Whether a shared host is currently booted. Lets a caller tear one down
  // without booting one first.
  static hasShared() {
    return Boolean(this.#shared) && !this.#shared.destroyed;
  }

  // Ends the shared host, if there is one. Called when the package goes away.
  static releaseShared() {
    if (!this.#shared) return;
    this.#shared.end();
    this.#shared = null;
  }

  destroyed = false;
  process = null;
  booted = false;

  #sessions = new Map();
  #emitter = new Emitter();
  #bootedPromise;
  #bootReject;

  // The last few things the worker wrote to stderr. Its crash handler writes a
  // diagnostic there and exits immediately, so by the time we hear about the
  // exit this is the only account of what went wrong.
  #recentStderr = [];

  constructor({ dedicated = false } = {}) {
    this.dedicated = dedicated;
    this.start();
  }

  start() {
    let options = {};

    options.env ??= Object.create(process.env);
    options.env.ELECTRON_RUN_AS_NODE = "1";
    options.env.ELECTRON_NO_ATTACH_CONSOLE = "1";

    let args = [];
    args.unshift(WORKER_PATH);
    args.unshift("--no-deprecation");

    this.process = this.spawn(process.execPath, args, options);

    // A pipe to a process that has died raises `EPIPE` here. There is nothing
    // to do about it — the `exit` handler below is what responds to a dead
    // worker — but an unhandled stream error would take down the renderer.
    this.process.stdin?.on("error", (error) => {
      Logger.error("Error writing to the PTY host:", error);
    });

    this.#bootedPromise = timeout(
      new Promise((resolve, reject) => {
        if (this.booted) return resolve();
        this.#bootReject = reject;
        this.#emitter.once("did-boot", resolve);
      }),
      5000,
      { tag: "Booted" },
    );
    // A worker that dies before it boots rejects this at once rather than
    // leaving every caller to wait out the timeout. Nothing may be awaiting it
    // at that moment, so keep the rejection from being reported as unhandled —
    // `whenBooted` still sees it.
    this.#bootedPromise.catch(() => {});

    this.process.stdout.pipe(ndjson.parse({ strict: false })).on("data", (message) => {
      if (this.destroyed) return;
      if (message.type === "ready") {
        this.booted = true;
        this.#emitter.emit("did-boot");
        return;
      }
      if (message.type === "log") {
        Logger.log("[Worker]", message.payload);
        return;
      }
      this.#sessions.get(message.id)?.handleMessage(message);
    });

    this.process.stderr.pipe(ndjson.parse({ strict: false })).on("data", (message) => {
      if (message.type !== "stderr") return;
      this.#recentStderr.push(message.payload);
      if (this.#recentStderr.length > 10) this.#recentStderr.shift();
      Logger.error("[Worker stderr]", message.payload);
      for (let session of this.#sessions.values()) {
        session.handleStderr(message.payload);
      }
    });

    this.process.on("error", (error) => {
      Logger.error("Error from the PTY host:", error);
      this.#failSessions(error);
    });

    // A worker can die on its own — a crash inside `node-pty`, or its own
    // uncaught-exception handler exiting the process. `error` does not cover
    // that: it fires only when the spawn itself failed. Without this the host
    // would go on reporting itself as booted, `PtyHost.shared` would keep
    // handing out the corpse, and every terminal opened afterwards would write
    // its `spawn` into a closed stdin and time out waiting for a first byte.
    this.process.on("exit", (code, signal) => {
      if (this.destroyed) return;
      let reason = this.#recentStderr.join("\n").trim();
      let cause = signal ? `signal ${signal}` : `code ${code}`;
      Logger.error("The PTY host exited unexpectedly:", cause, reason);
      this.#failSessions(
        new Error(
          `The terminal process host exited unexpectedly (${cause})${reason ? `: ${reason}` : ""}`,
        ),
      );
    });
  }

  // Tells every session on this host that the host is gone, then ends it. The
  // sessions are copied first: handling the error detaches them, which is a
  // write to the map being iterated.
  #failSessions(error) {
    if (this.destroyed) return;
    if (!this.booted) this.#bootReject?.(error);
    for (let session of [...this.#sessions.values()]) {
      session.handleHostError(error);
    }
    this.end();
  }

  // Its own method so a spec can stand in for the child process.
  spawn(command, args, options) {
    return spawn(command, args, options);
  }

  async whenBooted() {
    return await this.#bootedPromise;
  }

  attach(session) {
    this.#sessions.set(session.id, session);
  }

  detach(session) {
    this.#sessions.delete(session.id);
    // A host of its own has nothing left to do once its one session is gone.
    // The shared host stays up for the next terminal.
    if (this.dedicated && this.#sessions.size === 0) {
      this.end();
    }
  }

  send(message) {
    if (this.destroyed) return;
    // A worker that has gone away leaves its stdin behind, closed. Writing to
    // it raises an asynchronous stream error with nowhere to go, so check that
    // it is still open rather than finding out that way.
    if (!this.process?.stdin?.writable) return;
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  // Ends the worker process. It stays alive for as long as its stdin is open —
  // that is how it waits for work — so closing stdin is what lets it exit.
  end() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.#sessions.clear();
    this.process?.stdin?.end();
    this.process?.kill();
    this.#emitter.dispose();
    if (PtyHost.#shared === this) PtyHost.#shared = null;
  }
}

class Pty {
  readyState = PtyState.CREATED;
  destroyed = false;
  subscriptions = new CompositeDisposable();

  emitter = new Emitter();

  error = false;

  // Whether a shell has been asked for yet. A session on a host that was
  // booted ahead of time has not, and is torn down differently — see {::kill}.
  launched = false;

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

  // The worker process behind this session. Callers use its presence to decide
  // whether the session got off the ground at all.
  get process() {
    return this.host?.process ?? null;
  }

  // `options` describes the shell to run. It may be omitted, in which case the
  // session attaches to its host and waits — a caller that knows it will want
  // a terminal soon can get the host booting in parallel with its own setup
  // and call {::launch} once it knows the cwd and environment.
  //
  // `dedicated` gives this session a worker process to itself instead of the
  // shared one. It costs a Node startup and about 100MB, and buys isolation: a
  // worker that dies takes down only its own terminal.
  constructor(options, { dedicated = false } = {}) {
    this.options = options;
    this.id = uid++;
    this.host = dedicated ? new PtyHost({ dedicated: true }) : PtyHost.shared();
    this.host.attach(this);
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
    return this.emitter.on("stderr", callback);
  }

  onExit(callback) {
    return this.emitter.on("exit", callback);
  }

  changeReadyState(newState) {
    this.readyState = newState;
    this.emitter.emit("did-change-ready-state", newState);
  }

  // Everything the host routes to this session.
  handleMessage(message) {
    if (this.destroyed) return;
    switch (message.type) {
      case "data":
        if (this.readyState !== PtyState.READY) {
          this.changeReadyState(PtyState.READY);
        }
        if (message.meta) {
          Object.assign(this.meta, message.meta);
        }
        this.emitter.emit("data", message.payload);
        break;
      case "exit":
        this.emitter.emit("exit", message.payload.exitCode);
        break;
      case "meta":
        Object.assign(this.meta, message.payload);
        break;
      case "error":
        // Emitted, never thrown: this arrives from a stream callback, where a
        // throw has nowhere to go. Anything awaiting {::ready} rejects with it,
        // which is how a shell that could not be launched reaches the user.
        this.error = true;
        this.emitter.emit(
          "error",
          isError(message.payload) ? message.payload : new Error(message.payload),
        );
        break;
      default:
      // Do nothing.
    }
  }

  handleStderr(payload) {
    if (this.destroyed) return;
    this.emitter.emit("stderr", payload);
  }

  handleHostError(error) {
    if (this.destroyed) return;
    this.error = true;
    this.emitter.emit("error", error);
    this.kill();
  }

  async start() {
    // Whether a shell was named at construction, read before the first await:
    // by the time this resumes a caller may have called {::launch}, which
    // populates `this.options` — and launching a second time would run a
    // second shell inside the one terminal.
    let shellFromConstructor = this.options;

    this.error = false;

    try {
      await this.host.whenBooted();
      if (this.destroyed) return;

      if (!this.process?.stdin) {
        this.emitError(new Error("Failed to spawn PTY"));
      }

      if (shellFromConstructor && !this.launched) {
        await this.launch(shellFromConstructor);
      }
    } catch (error) {
      // Nothing awaits `start` — it runs from the constructor — so a rejection
      // escaping here would surface only as an unhandled one. Everything that
      // can fail above has already told this session's own listeners, which is
      // how it reaches the terminal.
      Logger.error("Failed to start the PTY session:", error);
    }
  }

  // Tells the host which shell this session should run. Resolves once the shell
  // has sent its first data, so a caller can still await the whole startup.
  async launch(options) {
    this.options = options;
    this.launched = true;
    // The host may still be booting; nothing may be sent before it is
    // listening on stdin.
    await this.host.whenBooted();
    if (this.destroyed) return;

    this.#sendMessage({ type: "spawn", payload: this.options });

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
    if (!this.launched) {
      // Nothing was ever spawned for this session, so there is nothing for the
      // worker to kill — just stop being one of its sessions.
      this.host?.detach(this);
      this.destroy();
      return;
    }
    this.#killProcess(signal);
    if (isWindows()) {
      this.#killDescendantsOnWindows();
    }
    this.host?.detach(this);
    this.destroy();
  }

  forceKill() {
    this.#killProcess();
    this.host?.detach(this);
    this.destroy();
  }

  write(data) {
    this.#sendMessage({ type: "write", payload: data });
  }

  destroy() {
    this.destroyed = true;
    this.subscriptions.dispose();
  }

  removeAllListeners(eventType) {
    this.#sendMessage({ type: "removeAllListeners", payload: eventType });
  }

  #sendMessage(message) {
    this.host?.send({ ...message, id: this.id });
  }

  #killProcess(signal) {
    // We don't distinguish between killing and graceful exit. That distinction
    // seems not to exist in `node-pty`, nor in VS Code’s terminal.
    let message = { type: "kill", payload: {} };
    if (!isWindows() && signal) {
      message.payload.signal = signal;
    }
    this.#sendMessage(message);
  }

  // `node-pty` leaves this session's shell with orphaned children on Windows,
  // so sweep them by hand. Only the descendants of *this* session's shell —
  // the host's other children belong to other terminals.
  #killDescendantsOnWindows() {
    if (!isWindows()) return;

    let rootPid = this.pid;
    if (!rootPid) return;

    let wmicProcess;
    try {
      wmicProcess = spawn("wmic", [
        "process",
        "where",
        `(ParentProcessId=${rootPid})`,
        "get",
        "processid",
      ]);
    } catch {
      return;
    }
    if (!wmicProcess.stdout) return;

    wmicProcess.on("error", () => {});

    let output = "";
    wmicProcess.stdout.on("data", (data) => (output += data));
    wmicProcess.stdout.on("close", () => {
      for (let rawPid of output.split(/\s+/)) {
        if (!/^\d{1,10}$/.test(rawPid)) continue;
        let pid = parseInt(rawPid, 10);

        if (!pid || pid === rootPid) continue;

        try {
          process.kill(pid);
        } catch {
          // The process may already be gone; ignore.
        }
      }
    });
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

  // Resolves once the worker behind this session is listening. Kept as a method
  // on the session because callers await it alongside {::ready}.
  async booted() {
    await this.host.whenBooted();
    if (this.readyState < PtyState.BOOTED) {
      this.changeReadyState(PtyState.BOOTED);
    }
  }

  async ready() {
    return await this.#waitForReadyState(PtyState.READY);
  }

  pause() {
    this.#sendMessage({ type: "pause", payload: null });
  }

  resume() {
    this.#sendMessage({ type: "resume", payload: null });
  }

  clear() {
    this.#sendMessage({ type: "clear", payload: null });
  }

  resize(cols, rows) {
    this.#sendMessage({ type: "resize", payload: [cols, rows] });
  }
}

module.exports = { Pty, PtyHost };
