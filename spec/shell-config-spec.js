const path = require("node:path");

describe("Terminal shell configuration", () => {
  const shellKey = "terminal.terminal.shell";
  const legacyMarker = "terminal.autoShellSet";
  let originalShell, originalMarker, originalComspec;
  let configWrites, storageReads, storageWrites, storageRemovals;

  async function activate() {
    const pack = await lumine.packages.loadPackage("terminal");
    const utils = require(path.join(pack.path, "lib", "utils"));
    if (!jasmine.isSpy(utils.isWindows)) spyOn(utils, "isWindows").and.returnValue(true);
    const active = await lumine.packages.activatePackage("terminal");
    expect(active.mainModule.activated).toBeTrue();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function expectNoAutomaticWrites() {
    expect(configWrites.calls.allArgs().filter(([key]) => key === shellKey)).toEqual([]);
    expect(storageReads.calls.allArgs().filter(([key]) => key === legacyMarker)).toEqual([]);
    expect(storageWrites.calls.allArgs().filter(([key]) => key === legacyMarker)).toEqual([]);
    expect(storageRemovals.calls.allArgs().filter(([key]) => key === legacyMarker)).toEqual([]);
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    await lumine.packages.deactivatePackage("terminal");
    await lumine.packages.loadPackage("terminal");
    originalShell = lumine.config.get(shellKey);
    originalMarker = localStorage.getItem(legacyMarker);
    originalComspec = process.env.COMSPEC;
    process.env.COMSPEC = "C:\\Windows\\System32\\cmd.exe";
    lumine.config.set(shellKey, "");
    localStorage.removeItem(legacyMarker);
    configWrites = spyOn(lumine.config, "set").and.callThrough();
    const storagePrototype = Object.getPrototypeOf(localStorage);
    storageReads = spyOn(storagePrototype, "getItem").and.callThrough();
    storageWrites = spyOn(storagePrototype, "setItem").and.callThrough();
    storageRemovals = spyOn(storagePrototype, "removeItem").and.callThrough();
  });

  afterEach(async () => {
    await lumine.packages.deactivatePackage("terminal");
    lumine.config.set(shellKey, originalShell);
    if (originalMarker === null) localStorage.removeItem(legacyMarker);
    else localStorage.setItem(legacyMarker, originalMarker);
    if (originalComspec === undefined) delete process.env.COMSPEC;
    else process.env.COMSPEC = originalComspec;
  });

  it("keeps a blank shell after activation without a browser storage marker", async () => {
    await activate();

    expect(lumine.config.get(shellKey)).toBe("");
    expectNoAutomaticWrites();
  });

  it("keeps a shell blank after the user clears it and the package reactivates", async () => {
    lumine.config.set(shellKey, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    await activate();
    lumine.config.set(shellKey, "");
    await lumine.packages.deactivatePackage("terminal");
    configWrites.calls.reset();
    storageReads.calls.reset();
    storageWrites.calls.reset();
    storageRemovals.calls.reset();

    await activate();

    expect(lumine.config.get(shellKey)).toBe("");
    expectNoAutomaticWrites();
  });

  it("preserves an explicitly configured shell that matches COMSPEC", async () => {
    lumine.config.set(shellKey, process.env.COMSPEC);
    configWrites.calls.reset();

    await activate();

    expect(lumine.config.get(shellKey)).toBe(process.env.COMSPEC);
    expectNoAutomaticWrites();
  });

  it("does not depend on an old browser storage marker", async () => {
    localStorage.setItem(legacyMarker, "true");
    storageWrites.calls.reset();

    await activate();

    expect(lumine.config.get(shellKey)).toBe("");
    expectNoAutomaticWrites();
  });
});
