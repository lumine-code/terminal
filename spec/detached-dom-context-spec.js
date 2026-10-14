describe("terminal commands across DOM realms", () => {
  let main, extra;
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage("terminal")).mainModule;
    extra = await lumine.workspace.openEditorWindow({ show: false });
  });
  afterEach(async () => {
    await lumine.workspace.discardEditorWindows();
    await lumine.packages.deactivatePackage("terminal");
  });
  it("resolves native auxiliary elements as command targets", () => {
    const terminal = extra.getDocument().createElement("terminal-view");
    const target = extra.getDocument().createElement("button");
    terminal.appendChild(target);
    expect(main.inferTerminalElement({ target })).toBe(terminal);
    const input = extra.getDocument().createElement("input");
    expect(main.describeFocus(input)).toEqual({ type: "element", element: input });
  });
  it("restores the command window's focus after another window updates global history", () => {
    const local = extra.getDocument().createElement("input");
    const other = document.createElement("input");
    extra.getElement().appendChild(local);
    lumine.workspace.getElement().appendChild(other);
    local.focus();
    local.dispatchEvent(new (extra.getDOMWindow().FocusEvent)("focusin", { bubbles: true }));
    expect(extra.getDocument().activeElement).toBe(local);
    expect(main.previousFocusByDocument.get(extra.getDocument())).toEqual({
      type: "element",
      element: local,
    });
    other.focus();
    const restore = spyOn(local, "focus").and.callThrough();
    const steal = spyOn(other, "focus").and.callThrough();
    expect(main.unfocus({ target: extra.getElement() })).toBeTrue();
    expect(restore).toHaveBeenCalled();
    expect(steal).not.toHaveBeenCalled();
    other.remove();
  });
});
