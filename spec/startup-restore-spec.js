describe("terminal startup restoration", () => {
  let pack, model;

  beforeEach(async () => {
    if (lumine.packages.getLoadedPackage("terminal"))
      await lumine.packages.unloadPackage("terminal", { serialize: false });
    pack = lumine.packages.loadPackage("terminal");
    pack.initializeForExternalUse("startup restoration spec");
    lumine.config.set("terminal.behavior.relaunchTerminalsOnStartup", true);
  });

  afterEach(async () => {
    model?.destroy();
    model = null;
    if (lumine.packages.getLoadedPackage("terminal"))
      await lumine.packages.unloadPackage("terminal", { serialize: false });
  });

  it("restores a terminal before activation and retains its collection afterwards", async () => {
    model = pack.mainModule.deserializeTerminalModel({ uri: "terminal://startup-restored" });
    const terminals = model.terminals;
    expect(terminals.has(model)).toBeTrue();
    await lumine.packages.activatePackage("terminal");
    expect(pack.mainModule.terminals).toBe(terminals);
    expect(pack.mainModule.terminals.has(model)).toBeTrue();
  });

  it("provides restored terminal views and releases them if startup stops", async () => {
    require("./helpers").stubPty();
    model = pack.mainModule.deserializeTerminalModel({ uri: "terminal://startup-view" });
    const element = lumine.views.getView(model);
    expect(element.tagName).toBe("TERMINAL-VIEW");
    expect(model.getElement()).toBe(element);
    spyOn(element, "destroy").and.callThrough();
    await pack.deactivate();
    expect(model.terminals.size).toBe(0);
    expect(element.destroy).toHaveBeenCalled();
  });
});
