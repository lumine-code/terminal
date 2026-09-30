const { activatePackage, stubPty, wait } = require("./helpers");

describe("closing a focused terminal", () => {
  let terminalPackage, terminal, centerEditor;

  beforeEach(async () => {
    jasmine.useRealClock();
    await lumine.reset();
    lumine.keymaps.loadBundledKeymaps();
    const packageInstance = await activatePackage();
    terminalPackage = packageInstance.mainModule;
    await lumine.updateProcessEnvAndTriggerHooks();
    jasmine.attachToDOM(lumine.workspace.getElement());
    stubPty();
    const { Terminal } = require("@xterm/xterm");
    spyOn(Terminal.prototype, "attachCustomKeyEventHandler").and.callThrough();
    centerEditor = await lumine.workspace.open();
    terminal = await terminalPackage.openInCenterOrDock(lumine.workspace.getRightDock());
    await terminal.ready();
    await terminal.element.createTerminal();
    await wait(0);
    if (!terminal.element.closest("lumine-dock.right")) {
      throw new Error("The terminal view must be mounted in its right dock before dispatching");
    }
    spyOn(lumine.workspace, "closeActivePaneItemOrEmptyPaneOrWindow");
  });

  afterEach(async () => {
    const remainingPane = lumine.workspace.paneForItem(terminal);
    if (remainingPane) await remainingPane.destroyItem(terminal);
  });

  function closeKeystroke(target) {
    const isDarwin = process.platform === "darwin";
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

  it("closes the terminal tab without sending a control character to the shell", async () => {
    // Tab closing stays available even after the user's optional command
    // priority list has been cleared.
    lumine.config.set("terminal.behavior.prioritizedCommands", []);
    const { Terminal } = require("@xterm/xterm");
    const keyboardHandler =
      Terminal.prototype.attachCustomKeyEventHandler.calls.mostRecent().args[0];

    const event = closeKeystroke(terminal.element.terminal.textarea);
    expect(keyboardHandler(event)).toBe(false);
    // The spec window reserves native Ctrl+W for exiting the runner, so send
    // the accepted event straight to the editor's keymap manager.
    lumine.keymaps.handleKeyboardEvent(event);
    await wait(0);

    expect(event.defaultPrevented).toBe(true);
    expect(lumine.workspace.closeActivePaneItemOrEmptyPaneOrWindow).not.toHaveBeenCalled();
    expect(lumine.workspace.paneForItem(terminal)).toBeUndefined();
    expect(centerEditor.isDestroyed()).toBe(false);
  });

  it("closes its owning tab when the terminal search field has focus", async () => {
    await terminal.element.findPalette.show();
    const searchEditor = terminal.element.findPalette.refs.search.getElement();
    expect(searchEditor.hasAttribute("mini")).toBe(true);

    lumine.keymaps.handleKeyboardEvent(closeKeystroke(searchEditor));
    await wait(0);

    expect(lumine.workspace.closeActivePaneItemOrEmptyPaneOrWindow).not.toHaveBeenCalled();
    expect(lumine.workspace.paneForItem(terminal)).toBeUndefined();
    expect(centerEditor.isDestroyed()).toBe(false);
  });
});
