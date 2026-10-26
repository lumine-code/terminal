describe("Terminal selection command origin", () => {
  let main, origin, focused, terminal;
  beforeEach(async () => {
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    localStorage.setItem("terminal.autoShellSet", "true");
    main = (await lumine.packages.activatePackage("terminal")).mainModule;
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    origin = await lumine.workspace.open();
    origin.setText("owned origin\n");
    origin.setSelectedBufferRange([
      [0, 0],
      [0, 12],
    ]);
    lumine.workspace.getActivePane().splitRight();
    focused = await lumine.workspace.open();
    focused.setText("owned focused\n");
    focused.setSelectedBufferRange([
      [0, 0],
      [0, 13],
    ]);
    expect(lumine.workspace.getActiveTextEditor()).toBe(focused);
    expect(origin.element.closest("lumine-workspace")).not.toBeNull();
    terminal = { paste: jasmine.createSpy("owned paste"), run: jasmine.createSpy("owned run") };
    spyOn(main, "getActiveTerminal").and.returnValue(terminal);
    spyOn(main, "performOnActiveTerminal").and.callFake((operation) => operation(terminal));
  });
  afterEach(async () => {
    origin?.destroy();
    focused?.destroy();
    await lumine.packages.deactivatePackage("terminal");
  });
  for (const [command, method] of [
    ["insert-selected-text", "paste"],
    ["run-selected-text", "run"],
  ]) {
    it(`takes ${command} from its actual non-active editor origin`, () => {
      lumine.commands.dispatch(origin.element, `terminal:${command}`);
      expect(terminal[method]).toHaveBeenCalledOnceWith("owned origin");
    });
    it(`keeps ${command} workspace-menu fallback on the active editor`, () => {
      lumine.commands.dispatch(lumine.views.getView(lumine.workspace), `terminal:${command}`);
      expect(terminal[method]).toHaveBeenCalledOnceWith("owned focused");
    });
  }

  it("checks selection command availability without extracting text or starting a terminal", () => {
    const selectedText = spyOn(origin, "getSelectedText").and.callThrough();
    const lineText = spyOn(origin, "lineTextForBufferRow").and.callThrough();
    const open = spyOn(main, "openTerminal");
    main.getActiveTerminal.and.returnValue(null);
    expect(
      lumine.commands.canDispatch(origin.element, "terminal:insert-selected-text"),
    ).toBeFalse();
    expect(lumine.commands.canDispatch(origin.element, "terminal:run-selected-text")).toBeTrue();
    expect(selectedText).not.toHaveBeenCalled();
    expect(lineText).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(lumine.commands.dispatch(origin.element, "terminal:insert-selected-text")).toBeNull();
    expect(selectedText).not.toHaveBeenCalled();
  });

  it("does not borrow the main editor from an explicitly empty command context", () => {
    expect(main.editorForSelection({ target: lumine.workspace.element, context: {} })).toBeNull();
  });

  for (const selected of [true, false]) {
    it(`rejects oversized ${selected ? "selection" : "line"} input before reads or terminal creation`, async () => {
      lumine.config.set("terminal.maximumEditorInputLength", 1024);
      origin.setText("x".repeat(2048));
      if (selected) origin.selectAll();
      else origin.setCursorBufferPosition([0, 0]);
      const selectedRead = spyOn(origin, "getSelectedText").and.throwError("unbounded selection");
      const lineRead = spyOn(origin, "lineTextForBufferRow").and.throwError("unbounded line");
      const cursor = origin.getCursorBufferPosition();
      expect(await main.runSelection({ target: origin.element })).toBeFalse();
      expect(selectedRead).not.toHaveBeenCalled();
      expect(lineRead).not.toHaveBeenCalled();
      expect(main.performOnActiveTerminal).not.toHaveBeenCalled();
      expect(terminal.run).not.toHaveBeenCalled();
      expect(origin.getCursorBufferPosition()).toEqual(cursor);
      expect(
        lumine.notifications
          .getNotifications()
          .some((notification) => notification.getMessage().includes("input budget")),
      ).toBeTrue();
      selectedRead.and.callThrough();
      lineRead.and.callThrough();
    });
  }

  it("advances the captured source only after a terminal accepts its line", async () => {
    origin.setSelectedBufferRange([
      [0, 0],
      [0, 0],
    ]);
    terminal.run.and.returnValue(false);
    await main.runSelection({ target: origin.element });
    expect(origin.getCursorBufferPosition().row).toBe(0);
    terminal.run.and.returnValue(true);
    await main.runSelection({ target: origin.element });
    expect(origin.getCursorBufferPosition().row).toBe(1);
  });

  it("does not move a cursor that changed while a terminal was opening", async () => {
    origin.setText("first\nsecond\nthird\n");
    origin.setCursorBufferPosition([0, 0]);
    let finish;
    const ready = new Promise((resolve) => {
      finish = resolve;
    });
    main.performOnActiveTerminal.and.callFake(async (operation) => {
      await ready;
      return operation(terminal);
    });
    const pending = main.runSelection({ target: origin.element });
    origin.setCursorBufferPosition([1, 2]);
    finish();
    await pending;
    expect(terminal.run).toHaveBeenCalledOnceWith("first");
    expect(origin.getCursorBufferPosition().toArray()).toEqual([1, 2]);
  });

  it("does not send a late selection after its editor closes", async () => {
    let finish;
    const ready = new Promise((resolve) => {
      finish = resolve;
    });
    main.performOnActiveTerminal.and.callFake(async (operation) => {
      await ready;
      return operation(terminal);
    });
    const pending = main.runSelection({ target: origin.element });
    origin.destroy();
    finish();
    expect(await pending).toBeFalse();
    expect(terminal.run).not.toHaveBeenCalled();
  });
});
