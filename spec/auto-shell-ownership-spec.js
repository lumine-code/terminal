const path = require("node:path");

describe("Terminal automatic shell publication", () => {
  let config, detection, lookupModule, originalLookup, completion, originalShell;
  beforeEach(async () => {
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    const pack = await lumine.packages.loadPackage("terminal");
    const root = path.join(pack.path, "lib");
    config = require(path.join(root, "config"));
    const utils = require(path.join(root, "utils"));
    spyOn(utils, "isWindows").and.returnValue(true);
    const lookupPath = require.resolve("which");
    require(lookupPath);
    lookupModule = require.cache[lookupPath];
    originalLookup = lookupModule.exports;
    const held = new Promise((resolve) => (completion = resolve));
    lookupModule.exports = jasmine.createSpy("controlled executable lookup").and.returnValue(held);
    originalShell = lumine.config.get("terminal.terminal.shell");
    lumine.config.set("terminal.terminal.shell", config.getDefaultShell());
    localStorage.setItem("terminal.autoShellSet", "true");
    const active = await lumine.packages.activatePackage("terminal");
    const owner = active.mainModule.subscriptions;
    localStorage.removeItem("terminal.autoShellSet");
    detection = config.possiblySetAutoShell(
      () => active.mainModule.activated && active.mainModule.subscriptions === owner,
    );
    expect(lookupModule.exports).toHaveBeenCalledWith("pwsh.exe", { nothrow: true });
  });
  afterEach(async () => {
    completion(null);
    await detection;
    lookupModule.exports = originalLookup;
    lumine.config.set("terminal.terminal.shell", originalShell);
    localStorage.setItem("terminal.autoShellSet", "true");
    await lumine.packages.deactivatePackage("terminal");
  });
  it("keeps a shell explicitly configured while the executable lookup is pending", async () => {
    lumine.config.set("terminal.terminal.shell", "owned-custom-shell");
    completion("owned-pwsh.exe");
    await detection;
    expect(lumine.config.get("terminal.terminal.shell")).toBe("owned-custom-shell");
  });
  it("does not publish the lookup after the actual Package retires", async () => {
    await lumine.packages.deactivatePackage("terminal");
    completion("owned-pwsh.exe");
    await detection;
    expect(lumine.config.get("terminal.terminal.shell")).toBe(config.getDefaultShell());
  });
  it("still publishes a current unchanged lookup", async () => {
    completion("owned-pwsh.exe");
    await detection;
    expect(lumine.config.get("terminal.terminal.shell")).toBe("owned-pwsh.exe");
  });
});
