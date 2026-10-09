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
    lumine.workspace.getActivePane().splitRight({ copyActiveItem: false });
    focused = await lumine.workspace.open();
    focused.setText("owned focused\n");
    focused.setSelectedBufferRange([
      [0, 0],
      [0, 13],
    ]);
    expect(lumine.workspace.getActiveTextEditor()).toBe(focused);
    expect(origin.element.closest("lumine-workspace")).not.toBeNull();
    terminal = { paste: jasmine.createSpy("owned paste"), run: jasmine.createSpy("owned run") };
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
});
