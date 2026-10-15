const os = require("node:os");
const path = require("node:path");
const { activatePackage } = require("./helpers");

describe("Terminal Launcher provider", () => {
  let main, provider, consumer, items;

  beforeEach(async () => {
    localStorage.setItem("terminal.autoShellSet", "true");
    main = (await activatePackage()).mainModule;
    items = [];
    consumer = lumine.packages.serviceHub.consume("launcher.provider", "^1.0.0", (value) => {
      if (value.id === "terminal") provider = value;
    });
  });

  afterEach(() => {
    consumer.dispose();
    for (const item of items) item.destroy();
  });

  it("publishes a synchronous provider that creates fresh unattached terminal models", async () => {
    expect(provider).toEqual(jasmine.objectContaining({ id: "terminal", label: "Terminal" }));
    const open = spyOn(lumine.workspace, "open").and.callThrough();
    const pane = lumine.workspace.getCenter().getActivePane();
    const activeItem = pane.getActiveItem();
    const first = await provider.create({ pane });
    const second = await provider.create({ pane });
    items.push(first, second);

    const { TerminalModel } = require("../lib/model");
    expect(first instanceof TerminalModel).toBe(true);
    expect(first.initialized).toBe(true);
    expect(first.getURI()).not.toBe(second.getURI());
    expect(main.terminals.has(first)).toBe(true);
    expect(first.element).toBeUndefined();
    expect(lumine.workspace.paneForItem(first)).toBeFalsy();
    expect(pane.getActiveItem()).toBe(activeItem);
    expect(open).not.toHaveBeenCalled();
  });

  it("resolves the directory from the requested pane instead of the global active item", async () => {
    const source = path.join(__dirname, "launcher-provider-spec.js");
    const pane = { getActiveItem: () => ({ getPath: () => source }) };
    const item = await provider.create({ pane });
    items.push(item);

    expect(item.cwd).toBe(__dirname);
  });

  it("inherits the source terminal working directory", async () => {
    const pane = { getActiveItem: () => ({ cwd: os.tmpdir() }) };
    const item = await provider.create({ pane });
    items.push(item);

    expect(item.cwd).toBe(os.tmpdir());
  });

  it("does not allocate a terminal for an aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const before = new Set(main.terminals);

    await expectAsync(provider.create({ signal: controller.signal })).toBeRejected();
    expect(main.terminals).toEqual(before);
  });

  it("releases a terminal when cancellation arrives during initialization", async () => {
    const controller = new AbortController();
    const { TerminalModel } = require("../lib/model");
    const initialize = TerminalModel.prototype.initialize;
    let created;
    spyOn(TerminalModel.prototype, "initialize").and.callFake(async function () {
      created = this;
      await initialize.call(this);
      controller.abort();
    });

    await expectAsync(provider.create({ signal: controller.signal })).toBeRejected();
    expect(main.terminals.has(created)).toBe(false);
  });

  it("rejects a retained provider after the package generation retires", async () => {
    const retained = provider;
    await lumine.packages.deactivatePackage("terminal");
    main = (await activatePackage()).mainModule;
    const before = new Set(main.terminals);

    await expectAsync(retained.create()).toBeRejectedWithError("Terminal is no longer active.");
    expect(main.terminals).toEqual(before);
  });
});
