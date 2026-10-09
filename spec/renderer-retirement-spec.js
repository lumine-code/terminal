const path = require("node:path");

describe("Terminal native renderer retirement", () => {
  let root, element, model, palette, addon, gate;
  beforeEach(async () => {
    element = model = palette = addon = gate = null;
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    localStorage.setItem("terminal.autoShellSet", "true");
    const pack = await lumine.packages.activatePackage("terminal");
    root = path.join(pack.path, "lib");
    require("@lumine-code/etch").setScheduler(lumine.views);
  });
  afterEach(async () => {
    gate?.();
    element?.destroy();
    model?.destroy();
    await palette?.destroy();
    addon?.dispose();
    await lumine.packages.deactivatePackage("terminal");
  });
  it("does not register native observers or config listeners after model readiness retires", async () => {
    const { TerminalModel } = require(path.join(root, "model"));
    const { TerminalElement } = require(path.join(root, "element"));
    model = new TerminalModel({ uri: "terminal://owned-retirement/", terminals: new Set() });
    await model.ready();
    const readiness = new Promise((resolve) => (gate = resolve));
    spyOn(model, "ready").and.returnValue(readiness);
    const NativeObserver = window.ResizeObserver;
    const observe = spyOn(window, "ResizeObserver").and.callFake(function (...args) {
      return new NativeObserver(...args);
    });
    const config = spyOn(lumine.config, "onDidChange").and.callThrough();
    element = TerminalElement.create();
    const initializing = element.initialize(model);
    element.destroy();
    observe.calls.reset();
    config.calls.reset();
    gate();
    await initializing;
    expect(observe).not.toHaveBeenCalled();
    expect(config).not.toHaveBeenCalled();
    expect(element.initialized).toBe(false);
  });
  it("retires the real search addon's result subscription and its mini editor", async () => {
    const FindPalette = require(path.join(root, "find-palette"));
    const { SearchAddon } = require(path.join(root, "../node_modules/@xterm/addon-search"));
    addon = new SearchAddon();
    let subscription;
    const listen = addon.onDidChangeResults.bind(addon);
    spyOnProperty(addon, "onDidChangeResults", "get").and.returnValue((callback) => {
      subscription = listen(callback);
      spyOn(subscription, "dispose").and.callThrough();
      return subscription;
    });
    palette = new FindPalette(addon);
    jasmine.attachToDOM(palette.element);
    await palette.show();
    const editor = palette.refs.search;
    expect(editor.isDestroyed()).toBe(false);
    await palette.destroy();
    expect(subscription.dispose).toHaveBeenCalled();
    expect(editor.isDestroyed()).toBe(true);
  });
  it("shares the current Core bridge with the constructor retained by the native registry", async () => {
    const { TerminalElement } = require(path.join(root, "element"));
    await lumine.packages.deactivatePackage("terminal");
    const pack = await lumine.packages.activatePackage("terminal");
    const bridge = { getBridgePortWhenReady: async () => 4321 };
    const provider = lumine.packages.serviceHub.provide("mcp.bridge", { "1.1.0": bridge });
    try {
      expect(pack.mainModule.activated).toBe(true);
      expect(customElements.get("terminal-view")).toBe(TerminalElement);
      expect(TerminalElement.mcpBridge).toBe(bridge);
    } finally {
      provider.dispose();
    }
  });
  it("routes current Core external services through the retained native constructor", async () => {
    const { TerminalElement } = require(path.join(root, "element"));
    await lumine.packages.deactivatePackage("terminal");
    const pack = await lumine.packages.activatePackage("terminal");
    root = path.join(pack.path, "lib");
    const { TerminalModel } = require(path.join(root, "model"));
    model = new TerminalModel({ uri: "terminal://owned-current-service/", terminals: new Set() });
    await model.ready();
    element = TerminalElement.create();
    await element.initialize(model);
    const service = {
      openExternal: jasmine.createSpy("owned external handler").and.resolveTo(""),
      showInFolder: jasmine.createSpy("owned folder handler").and.resolveTo(""),
    };
    const provider = lumine.packages.serviceHub.provide("open-external", { "1.0.0": service });
    try {
      const directory = path.join(process.env.LUMINE_HOME, "tmp");
      await element.activateLocalPathLink({ altKey: true, button: 0 }, directory, true);
      expect(service.openExternal).toHaveBeenCalledOnceWith(directory);
      expect(lumine.shell.openPath).not.toHaveBeenCalled();
    } finally {
      provider.dispose();
    }
  });
});
