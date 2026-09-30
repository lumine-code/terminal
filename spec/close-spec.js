const { activatePackage, stubPty, wait } = require("./helpers");

describe("closing from a focused terminal", () => {
  let terminalPackage, terminal, centerEditor;

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.reset();
    lumine.keymaps.loadBundledKeymaps();
    const packageInstance = await activatePackage();
    terminalPackage = packageInstance.mainModule;
    lumine.config.unset("terminal.behavior.prioritizedCommands");
    await lumine.updateProcessEnvAndTriggerHooks();
    jasmine.attachToDOM(lumine.workspace.getElement());
    stubPty();
    spyOn(HTMLTextAreaElement.prototype, "addEventListener").and.callThrough();
    centerEditor = await lumine.workspace.open();
  });

  afterEach(async () => {
    const remainingPane = lumine.workspace.paneForItem(terminal);
    if (remainingPane) await remainingPane.destroyItem(terminal);
  });

  async function openTerminal(container) {
    terminal = await terminalPackage.openInCenterOrDock(container);
    await terminal.ready();
    await terminal.element.createTerminal();
    await wait(0);
  }

  function closeKeystroke(target, { shell = false } = {}) {
    const isDarwin = !shell && process.platform === "darwin";
    const event = new KeyboardEvent("keydown", {
      key: "w",
      code: "KeyW",
      ctrlKey: !isDarwin,
      metaKey: isDarwin,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperties(event, {
      keyCode: { value: 87 },
      which: { value: 87 },
      target: { value: target },
    });
    return event;
  }

  function deliverToXterm(event) {
    // Invoke xterm's registered DOM handler directly because the test window
    // captures native Ctrl+W to exit before it can reach the textarea.
    const listener = HTMLTextAreaElement.prototype.addEventListener.calls
      .all()
      .find((call) => call.object === event.target && call.args[0] === "keydown").args[1];
    return listener(event);
  }

  it("delivers Ctrl+W to the shell when its terminal is in a dock", async () => {
    await openTerminal(lumine.workspace.getRightDock());
    const textarea = terminal.element.terminal.textarea;
    const onData = jasmine.createSpy("onData");
    terminal.element.terminal.onData(onData);
    const event = closeKeystroke(textarea, { shell: true });
    deliverToXterm(event);

    expect(onData).toHaveBeenCalledWith("\x17");
    expect(lumine.workspace.paneForItem(terminal)).toBeDefined();
    expect(centerEditor.isDestroyed()).toBe(false);
  });

  it("closes the terminal when it is an editor tab in the center", async () => {
    await openTerminal(lumine.workspace.getCenter());
    lumine.config.set("terminal.behavior.prioritizedCommands", []);
    const event = closeKeystroke(terminal.element.terminal.textarea);
    const onData = jasmine.createSpy("onData");
    terminal.element.terminal.onData(onData);
    expect(deliverToXterm(event)).toBe(false);
    expect(onData).not.toHaveBeenCalled();

    lumine.keymaps.handleKeyboardEvent(event);
    await wait(0);

    expect(event.defaultPrevented).toBe(true);
    expect(lumine.workspace.paneForItem(terminal)).toBeUndefined();
    expect(centerEditor.isDestroyed()).toBe(false);
  });

  it("honors an explicit priority override for the editor close command in a dock", async () => {
    await openTerminal(lumine.workspace.getRightDock());
    lumine.config.set("terminal.behavior.prioritizedCommands", ["core:close"]);
    const event = closeKeystroke(terminal.element.terminal.textarea);
    const onData = jasmine.createSpy("onData");
    terminal.element.terminal.onData(onData);

    expect(deliverToXterm(event)).toBe(false);
    expect(onData).not.toHaveBeenCalled();
    lumine.keymaps.handleKeyboardEvent(event);
    await wait(0);

    expect(lumine.workspace.paneForItem(terminal)).toBeDefined();
    expect(centerEditor.isDestroyed()).toBe(true);
  });

  it("uses the terminal's current container after moving its tab", async () => {
    await openTerminal(lumine.workspace.getRightDock());
    const pane = lumine.workspace.paneForItem(terminal);
    const centerPane = lumine.workspace.getCenter().getActivePane();
    const event = closeKeystroke(terminal.element.terminal.textarea);
    const onData = jasmine.createSpy("onData");
    terminal.element.terminal.onData(onData);
    deliverToXterm(event);
    if (process.platform !== "darwin") expect(onData).toHaveBeenCalledWith("\x17");
    onData.calls.reset();

    pane.moveItemToPane(terminal, centerPane);
    centerPane.activateItem(terminal);
    await wait(0);
    onData.calls.reset();
    expect(deliverToXterm(event)).toBe(false);
    expect(onData).not.toHaveBeenCalled();

    const dockPane = lumine.workspace.getRightDock().getActivePane();
    centerPane.moveItemToPane(terminal, dockPane);
    dockPane.activateItem(terminal);
    await wait(0);
    deliverToXterm(event);
    if (process.platform !== "darwin") expect(onData).toHaveBeenCalledWith("\x17");
  });

  it("closes the center editor from the dock terminal's search field", async () => {
    await openTerminal(lumine.workspace.getRightDock());
    await terminal.element.findPalette.show();
    const searchEditor = terminal.element.findPalette.refs.search.getElement();
    expect(searchEditor.hasAttribute("mini")).toBe(true);

    lumine.keymaps.handleKeyboardEvent(closeKeystroke(searchEditor));
    await wait(0);

    expect(lumine.workspace.paneForItem(terminal)).toBeDefined();
    expect(centerEditor.isDestroyed()).toBe(true);
  });
});
