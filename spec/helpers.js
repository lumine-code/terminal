const path = require("path");

async function activatePackage() {
  addToPackagePaths();
  let promise = lumine.packages.activatePackage("terminal");
  lumine.packages.triggerActivationHook("core:loaded-shell-environment");
  lumine.packages.triggerDeferredActivationHooks();
  await promise;
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
  const { Pty, PtyHost } = require("../lib/pty");
  PtyHost.releaseShared();
  let makeStream = () => {
    let stream = {
      // `PtyHost.send` refuses to write to a stream that has closed, which is
      // how it declines to talk to a worker that has died.
      writable: true,
      on: () => stream,
      once: () => stream,
      pipe: () => stream,
      write: () => {},
      end: () => {},
      removeAllListeners: () => stream,
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
  return mockProcess;
}

module.exports = {
  activatePackage,
  addToPackagePaths,
  stubPty,
  wait,
};
