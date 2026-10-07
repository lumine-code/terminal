const path = require("path");
const rendererPtyModules = new WeakMap();

// The native constructor survives a package module-cache teardown. Keep its
// actual PTY dependencies together so a spec does not spy on a new module
// generation while the document is still creating elements from the old one.
function registerRendererPtyModule(Element, ptyModule) {
  if (!rendererPtyModules.has(Element)) rendererPtyModules.set(Element, ptyModule);
}

async function activatePackage() {
  addToPackagePaths();
  let promise = lumine.packages.activatePackage("terminal");
  lumine.hooks.trigger("core:loaded-shell-environment");
  return promise;
}

function addToPackagePaths() {
  let packagePath = path.resolve(__dirname, "..", "..");
  if (!lumine.packages.packageDirPaths.includes(packagePath)) {
    lumine.packages.packageDirPaths.push(packagePath);
  }
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Replace the PTY host's process spawning with a no-op so specs don't launch a
// real `node-pty` worker (which needs a native build). `Pty.start` still runs
// against a fake process, and the readiness promises resolve immediately. Any
// host left over from an earlier spec is released first, so each spec observes
// its own.
function stubPty() {
  const Element = customElements.get("terminal-view");
  const { Pty, PtyHost } = rendererPtyModules.get(Element) || require("../lib/pty");
  PtyHost.releaseShared();
  let makeStream = () => {
    const listeners = new Map();
    let stream = {
      // `PtyHost.send` refuses to write to a stream that has closed, which is
      // how it declines to talk to a worker that has died.
      writable: true,
      on: (name, callback) => {
        const callbacks = listeners.get(name) || [];
        callbacks.push(callback);
        listeners.set(name, callbacks);
        return stream;
      },
      once: () => stream,
      pipe: () => stream,
      write: () => {},
      end: () => {},
      removeAllListeners: () => stream,
      trigger: (name, value) => {
        for (const callback of listeners.get(name) || []) callback(value);
      },
    };
    return stream;
  };
  let mockProcess = {
    stdin: makeStream(),
    stdout: makeStream(),
    stderr: makeStream(),
    on: () => {},
    once: () => {},
    kill: () => {},
    removeAllListeners: () => {},
    pid: 1,
  };
  spyOn(PtyHost.prototype, "spawn").and.returnValue(mockProcess);
  spyOn(PtyHost.prototype, "whenBooted").and.returnValue(Promise.resolve());
  spyOn(Pty.prototype, "ready").and.returnValue(Promise.resolve());
  spyOn(Pty.prototype, "kill").and.returnValue(undefined);
  // Stubbing whenBooted does not settle the host's underlying timeout promise.
  // Deliver the real startup signal after its stdout listener is attached.
  queueMicrotask(() => mockProcess.stdout.trigger("data", { type: "ready", payload: null }));
  return mockProcess;
}

module.exports = {
  activatePackage,
  addToPackagePaths,
  stubPty,
  registerRendererPtyModule,
  wait,
};
