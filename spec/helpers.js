const path = require("path");

async function activatePackage() {
  addToPackagePaths();
  let promise = atom.packages.activatePackage("terminal");
  atom.packages.triggerActivationHook("core:loaded-shell-environment");
  atom.packages.triggerDeferredActivationHooks();
  await promise;
}

function addToPackagePaths() {
  let packagePath = path.resolve(__dirname, "..", "..");
  if (!atom.packages.packageDirPaths.includes(packagePath)) {
    atom.packages.packageDirPaths.push(packagePath);
  }
}

async function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Replace the PTY's process spawning with a no-op so specs don't launch a real
// `node-pty` worker (which needs a native build). `Pty.start` still runs against
// a fake process, and the readiness promises resolve immediately.
function stubPty(Pty) {
  let makeStream = () => {
    let stream = {
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
  spyOn(Pty.prototype, "spawn").and.returnValue(mockProcess);
  spyOn(Pty.prototype, "booted").and.returnValue(Promise.resolve());
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
