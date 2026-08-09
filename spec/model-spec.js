const { TerminalModel } = require("../lib/model");

const fs = require("fs-extra");
const path = require("path");
const temp = require("@lumine-code/temp");

temp.track();

describe("TerminalModel", () => {
  let model, pane, element, tmpdir, uri, terminals;

  beforeEach(async () => {
    uri = "terminal://some-session-id";
    terminals = new Set();
    model = new TerminalModel({ uri, terminals });
    await model.ready();
    pane = jasmine.createSpyObj("pane", ["destroyItem", "getActiveItem", "activateItem"]);
    element = jasmine.createSpyObj("element", [
      "destroy",
      "refitTerminal",
      "focusTerminal",
      "clickOnCurrentAnchor",
      "getCurrentAnchorHref",
      "restartPtyProcess",
    ]);
    element.terminal = jasmine.createSpyObj("terminal", ["getSelection"]);
    element.pty = jasmine.createSpyObj("pty", ["write"]);
    tmpdir = await temp.mkdir();
  });

  afterEach(async () => await temp.cleanup());

  it("handles a previous active item that has no getPath() method", async () => {
    lumine.config.set("terminal.terminal.useProjectRootAsCwd", true);
    lumine.project.setPaths([tmpdir]);
    spyOn(lumine.workspace, "getActivePaneItem").and.returnValue({});
    let newModel = new TerminalModel({ uri, terminals });
    await newModel.ready();
    expect(newModel.cwd).toBe(tmpdir);
  });

  it("handles a previous active item whose getPath() method returns a directory", async () => {
    lumine.config.set("terminal.terminal.useProjectRootAsCwd", true);
    let someOtherTmpDir = await temp.mkdir();
    let previousActiveItem = jasmine.createSpyObj("somemodel", ["getPath"]);
    lumine.project.setPaths([someOtherTmpDir, tmpdir]);
    previousActiveItem.getPath.and.returnValue(tmpdir);
    spyOn(lumine.workspace, "getActivePaneItem").and.returnValue(previousActiveItem);
    let newModel = new TerminalModel({ uri, terminals });
    await newModel.ready();
    expect(newModel.cwd).toBe(tmpdir);
  });

  it("handles a previous active item whose getPath() method returns a file", async () => {
    lumine.config.set("terminal.terminal.useProjectRootAsCwd", true);
    let someOtherTmpDir = await temp.mkdir();
    let previousActiveItem = jasmine.createSpyObj("somemodel", ["getPath"]);
    lumine.project.setPaths([someOtherTmpDir, tmpdir]);
    previousActiveItem.getPath.and.returnValue(`${tmpdir}${path.sep}foo.txt`);
    spyOn(lumine.workspace, "getActivePaneItem").and.returnValue(previousActiveItem);
    let newModel = new TerminalModel({ uri, terminals });
    await newModel.ready();
    expect(newModel.cwd).toBe(tmpdir);
  });

  it('handles a previous active item that has a "selectedPath" property that returns a directory', async () => {
    lumine.config.set("terminal.terminal.useProjectRootAsCwd", true);
    let someOtherTmpDir = await temp.mkdir();
    lumine.project.setPaths([someOtherTmpDir, tmpdir]);
    let previousActiveItem = {};
    previousActiveItem.selectedPath = tmpdir;
    spyOn(lumine.workspace, "getActivePaneItem").and.returnValue(previousActiveItem);
    let newModel = new TerminalModel({ uri, terminals });
    await newModel.ready();
    expect(newModel.cwd).toBe(tmpdir);
  });

  it('handles a previous active item that has a "selectedPath" property that returns a file', async () => {
    lumine.config.set("terminal.terminal.useProjectRootAsCwd", true);
    let someOtherTmpDir = await temp.mkdir();
    lumine.project.setPaths([someOtherTmpDir, tmpdir]);
    let previousActiveItem = {};
    previousActiveItem.selectedPath = `${tmpdir}${path.sep}foo.txt`;
    spyOn(lumine.workspace, "getActivePaneItem").and.returnValue(previousActiveItem);
    let newModel = new TerminalModel({ uri, terminals });
    await newModel.ready();
    expect(newModel.cwd).toBe(tmpdir);
  });

  it("handles a previous active item whose getPath() returns an invalid path", async () => {
    let dirPath = path.join(tmpdir, "dir");
    await fs.mkdir(dirPath);
    lumine.project.setPaths([dirPath]);
    let previousActiveItem = jasmine.createSpyObj("somemodel", ["getPath"]);
    previousActiveItem.getPath.and.returnValue(path.join(tmpdir, "non-existent-dir"));
    spyOn(lumine.workspace, "getActivePaneItem").and.returnValue(previousActiveItem);
    let newModel = new TerminalModel({ uri, terminals });
    await newModel.ready();
    expect(newModel.cwd).toBe(dirPath);
  });

  it("handles a previous active item which exists in the project path and has getPath()", async () => {
    let previousActiveItem = jasmine.createSpyObj("somemodel", ["getPath"]);
    previousActiveItem.getPath.and.returnValue("/some/dir/file");
    spyOn(lumine.workspace, "getActivePaneItem").and.returnValue(previousActiveItem);
    const expected = ["/some/dir", null];
    spyOn(lumine.project, "relativizePath").and.returnValue(expected);
    const newModel = new TerminalModel({ uri, terminals });
    await newModel.ready();
    expect(newModel.cwd).toBe(expected[0]);
  });

  it("handles a previous active item which exists in the project path and has selectedPath", async () => {
    let previousActiveItem = {};
    previousActiveItem.selectedPath = "/some/dir/file";
    spyOn(lumine.workspace, "getActivePaneItem").and.returnValue(previousActiveItem);
    const expected = ["/some/dir", null];
    spyOn(lumine.project, "relativizePath").and.returnValue(expected);
    const newModel = new TerminalModel({ uri, terminals });
    await newModel.ready();
    expect(newModel.cwd).toBe(expected[0]);
  });

  it("handles being constructed with a target cwd", async () => {
    let expected = __dirname;
    let url = new URL(uri);
    url.searchParams.set("cwd", __filename);
    let newModel = new TerminalModel({ uri: url.href, terminals });
    await newModel.ready();
    expect(newModel.cwd).toBe(expected);
  });

  it("serializes", () => {
    let specificUri = model.getURI();
    expect(model.serialize()).toEqual({
      deserializer: "TerminalModel",
      version: "1.0.0",
      uri: specificUri,
    });
  });

  describe("destroy()", () => {
    it("destroys the element", () => {
      model.element = element;
      model.destroy();
      expect(model.element.destroy).toHaveBeenCalled();
    });

    it("removes the terminal from the master set", () => {
      expect(terminals.has(model)).toBe(true);
      model.destroy();
      expect(terminals.has(model)).toBe(false);
    });
  });

  describe("getTitle()", () => {
    it("uses the standard title by default", () => {
      expect(model.getTitle()).toBe("Terminal");
    });
  });

  describe("getElement()", () => {
    it("returns the element", () => {
      let expected = { something: "something" };
      model.element = expected;
      expect(model.getElement()).toBe(expected);
    });
  });

  describe("getLongTitle()", () => {
    it("returns the correct long title when the title is the default", () => {
      expect(model.getLongTitle()).toBe("Terminal");
    });

    it("returns the correct long title when the title has been customized", () => {
      model.title = "some new title";
      expect(model.getLongTitle()).toBe("Terminal (some new title)");
    });
  });

  describe("onDidChangeTitle()", () => {
    it("broadcasts title changes", () => {
      let spy = jasmine.createSpy("titleSpy");
      let disposable = model.onDidChangeTitle(spy);
      let expected = "new title";
      model.emitter.emit("did-change-title", expected);
      expect(spy).toHaveBeenCalledWith(expected);
      disposable.dispose();
    });
  });

  describe("getIconName()", () => {
    it("shows the correct icon", () => {
      expect(model.getIconName()).toBe("terminal");
    });
  });

  describe("the path contract", () => {
    // `getPath` names the document an item displays, and everything reading it
    // treats the answer as one — the tab bar shows it on hover and colours the
    // tab by its git status. A terminal displays no document, so a terminal
    // opened from an editor's context menu claimed that editor's file as its
    // own, tooltip and orange tab included.
    it("implements no ::getPath", () => {
      expect(model.getPath).toBeUndefined();
    });

    it("keeps its working directory to itself", async () => {
      let url = new URL(uri);
      url.searchParams.set("cwd", __filename);
      let newModel = new TerminalModel({ uri: url.href, terminals });
      await newModel.ready();

      expect(newModel.cwd).toBe(__dirname);
      expect(newModel.getPath).toBeUndefined();
    });
  });

  it("starts a terminal opened from a terminal in that terminal's directory", async () => {
    let previousActiveItem = new TerminalModel({ uri, terminals });
    await previousActiveItem.ready();
    previousActiveItem.cwd = tmpdir;
    spyOn(lumine.workspace, "getActivePaneItem").and.returnValue(previousActiveItem);

    let newModel = new TerminalModel({ uri, terminals });
    await newModel.ready();

    expect(newModel.cwd).toBe(tmpdir);
  });

  describe("the modified-state contract", () => {
    // A terminal has nothing to save, so it opts out of the save-state API
    // entirely. `tabs` and core both feature-detect these, and a terminal that
    // reported itself modified was skipped by `tabs:close-saved-tabs`.
    it("implements neither ::isModified nor ::onDidChangeModified", () => {
      expect(model.isModified).toBeUndefined();
      expect(model.onDidChangeModified).toBeUndefined();
    });

    it("implements neither ::shouldPromptToSave nor ::save", () => {
      expect(model.shouldPromptToSave).toBeUndefined();
      expect(model.save).toBeUndefined();
    });
  });

  describe("handleNewData()", () => {
    it("functions as expected when the model initially has no pane set", () => {
      pane.getActiveItem.and.returnValue({});
      spyOn(lumine.workspace, "paneForItem").and.returnValue(pane);
      model.handleNewData();
      expect(lumine.workspace.paneForItem).toHaveBeenCalled();
    });

    it("emits a title change only when the title actually changed", () => {
      model.pane = pane;
      model.title = "one";
      spyOn(model.emitter, "emit");
      model.handleNewData();
      model.handleNewData();
      expect(
        model.emitter.emit.calls.all().filter((call) => call.args[0] === "did-change-title").length,
      ).toBe(1);
    });

    it("never emits a modified change, whether or not it is the active item", () => {
      pane.getActiveItem.and.returnValue({});
      model.pane = pane;
      spyOn(model.emitter, "emit");
      model.handleNewData();
      pane.getActiveItem.and.returnValue(model);
      model.handleNewData();
      expect(
        model.emitter.emit.calls.all().filter((call) => call.args[0] === "did-change-modified")
          .length,
      ).toBe(0);
    });
  });

  describe("getSessionId()", () => {
    it("returns a unique ID for the terminal", () => {
      expect(model.getSessionId()).toBe("some-session-id");
    });
  });

  describe("refitTerminal()", () => {
    it("should be able to refit the terminal even when an element has not been set", () => {
      model.refitTerminal();
    });

    it("should be able to refit the terminal with an element set", () => {
      model.element = element;
      model.refitTerminal();
      expect(model.element.refitTerminal).toHaveBeenCalled();
    });
  });

  describe("focusTerminal()", () => {
    it("calls through to the element", () => {
      model.element = element;
      model.focusTerminal();
      expect(model.element.focusTerminal).toHaveBeenCalled();
    });

    it("emits no modified change", () => {
      model.element = element;
      spyOn(model.emitter, "emit");
      model.focusTerminal();
      expect(
        model.emitter.emit.calls.all().filter((call) => call.args[0] === "did-change-modified")
          .length,
      ).toBe(0);
    });

    it("activates the pane item", () => {
      model.element = element;
      model.pane = pane;
      model.focusTerminal();
      expect(model.pane.activateItem).toHaveBeenCalledWith(model);
    });

    it('passes along the "double" parameter', () => {
      model.element = element;
      model.focusTerminal(true);
      expect(model.element.focusTerminal).toHaveBeenCalledWith(true);
    });
  });

  describe("exit()", () => {
    it("destroys the model", () => {
      model.pane = pane;
      model.exit();
      expect(model.pane.destroyItem.calls.argsFor(0)).toEqual([model, true]);
    });
  });

  describe("restartPtyProcess()", () => {
    it("is a no-op with no element set", () => {
      model.restartPtyProcess();
      expect(element.restartPtyProcess).not.toHaveBeenCalled();
    });

    it("works with an element set", () => {
      model.element = element;
      model.restartPtyProcess();
      expect(element.restartPtyProcess).toHaveBeenCalled();
    });
  });

  describe("getSelection()", () => {
    it("gets text from the terminal", () => {
      model.element = element;
      model.getSelection();
      expect(model.element.terminal.getSelection).toHaveBeenCalled();
    });
  });

  describe("run()", () => {
    it("runs a command", () => {
      model.element = element;
      let expectedText = "some text";
      model.run(expectedText);
      let args = model.element.pty.write.calls.argsFor(0);
      expect(args).toEqual([expectedText + (process.platform === "win32" ? "\r" : "\n")]);
    });
  });

  describe("paste()", () => {
    it("inserts text", () => {
      model.element = element;
      let expectedText = "some text";
      model.paste(expectedText);
      let args = model.element.pty.write.calls.argsFor(0);
      expect(args).toEqual([expectedText]);
    });
  });

  describe("setActive()", () => {
    it("manages the active terminal correctly", async () => {
      let activePane = lumine.workspace.getCenter().getActivePane();
      let newTerminals = new Set();
      let model1 = new TerminalModel({ uri, terminals: newTerminals });
      await model1.ready();
      activePane.addItem(model1);
      model1.moveToPane(activePane);

      let model2 = new TerminalModel({ uri, terminals: newTerminals });
      await model2.ready();
      activePane.addItem(model2);
      model2.moveToPane(activePane);

      expect(model1.activeIndex).toBe(0);
      expect(model2.activeIndex).toBe(1);

      model2.setActive();
      expect(model1.activeIndex).toBe(1);
      expect(model2.activeIndex).toBe(0);
    });
  });

  describe("moveToPane()", () => {
    it("(mock)", async () => {
      const expected = { getContainer: () => ({ getLocation: () => {} }) };
      model.moveToPane(expected);
      expect(model.pane).toBe(expected);
      expect(model.dock).toBe(undefined);
    });

    it("(center)", async () => {
      const activePane = lumine.workspace.getCenter().getActivePane();
      model.moveToPane(activePane);
      expect(model.pane).toBe(activePane);
      expect(model.dock).toBe(undefined);
    });

    it("(left)", async () => {
      const dock = lumine.workspace.getLeftDock();
      const activePane = dock.getActivePane();
      model.moveToPane(activePane);
      expect(model.pane).toBe(activePane);
      expect(model.dock).toBe(dock);
    });

    it("(right)", async () => {
      const dock = lumine.workspace.getRightDock();
      const activePane = dock.getActivePane();
      model.moveToPane(activePane);
      expect(model.pane).toBe(activePane);
      expect(model.dock).toBe(dock);
    });

    it("(bottom)", async () => {
      const dock = lumine.workspace.getBottomDock();
      const activePane = dock.getActivePane();
      model.moveToPane(activePane);
      expect(model.pane).toBe(activePane);
      expect(model.dock).toBe(dock);
    });
  });

  describe("isVisible()", () => {
    it("works within a pane", () => {
      let activePane = lumine.workspace.getCenter().getActivePane();
      model.moveToPane(activePane);
      expect(model.isVisible()).toBe(false);
      activePane.setActiveItem(model);
      expect(model.isVisible()).toBe(true);
    });

    it("works within a dock", () => {
      let dock = lumine.workspace.getBottomDock();
      let activePane = dock.getActivePane();
      model.moveToPane(activePane);
      activePane.setActiveItem(model);
      expect(model.isVisible()).toBe(false);
      dock.show();
      expect(model.isVisible()).toBe(true);
    });
  });

  describe("isActive()", () => {
    beforeEach(() => {
      lumine.config.set("terminal.behavior.activeTerminalLogic", "visible");
    });

    it("works when the terminal is visible and active", () => {
      model.activeIndex = 0;
      spyOn(model, "isVisible").and.returnValue(true);
      expect(model.isActive()).toBe(true);
    });

    it("works when the terminal is visible and not active", () => {
      model.activeIndex = 1;
      spyOn(model, "isVisible").and.returnValue(true);
      expect(model.isActive()).toBe(false);
    });

    it("works when the terminal is invisible and active", () => {
      model.activeIndex = 0;
      spyOn(model, "isVisible").and.returnValue(false);
      expect(model.isActive()).toBe(false);
    });

    it("works when the terminal is invisible and active (and we have opted into it via config)", () => {
      lumine.config.set("terminal.behavior.activeTerminalLogic", "all");
      model.activeIndex = 0;
      spyOn(model, "isVisible").and.returnValue(false);
      expect(model.isActive()).toBe(true);
    });
  });

  describe("TerminalModel.is()", () => {
    it("works when the item is a terminal model", () => {
      expect(TerminalModel.is(model)).toBe(true);
    });

    it("works when the item is not a terminal model", () => {
      let item = document.createElement("div");
      expect(TerminalModel.is(item)).toBe(false);
    });
  });

  describe("TerminalModel.recalculateActive()", () => {
    const createTerminals = (num = 1) => {
      const terminals = [];
      for (let i = 0; i < num; i++) {
        terminals.push({
          activeIndex: i,
          isVisible() {},
          emitter: {
            emit() {},
          },
          setIndex: function (newIndex) {
            this.activeIndex = newIndex;
            this.emitter.emit("did-change-title", this.title);
          },
          title: `title ${i}`,
        });
      }
      return terminals;
    };

    it("active first", () => {
      const terminals = createTerminals(2);
      TerminalModel.recalculateActive(new Set(terminals), terminals[1]);
      expect(terminals[0].activeIndex).toBe(1);
      expect(terminals[1].activeIndex).toBe(0);
    });

    it("visible before hidden", () => {
      const terminals = createTerminals(2);
      spyOn(terminals[1], "isVisible").and.returnValue(true);
      TerminalModel.recalculateActive(new Set(terminals));
      expect(terminals[0].activeIndex).toBe(1);
      expect(terminals[1].activeIndex).toBe(0);
    });

    it("activeTerminalLogic = 'all'", () => {
      lumine.config.set("terminal.behavior.activeTerminalLogic", "all");
      const terminals = createTerminals(2);
      spyOn(terminals[0], "isVisible").and.returnValue(false);
      spyOn(terminals[1], "isVisible").and.returnValue(true);
      TerminalModel.recalculateActive(new Set(terminals));
      expect(terminals[0].activeIndex).toBe(0);
      expect(terminals[1].activeIndex).toBe(1);
    });

    it("lower active index first", () => {
      const terminals = createTerminals(2);
      terminals[0].setIndex(1);
      terminals[1].setIndex(0);
      TerminalModel.recalculateActive(new Set(terminals));
      expect(terminals[0].activeIndex).toBe(1);
      expect(terminals[1].activeIndex).toBe(0);
    });

    it("emits did-change-title", () => {
      const terminals = createTerminals(2);
      spyOn(terminals[0].emitter, "emit");
      spyOn(terminals[1].emitter, "emit");
      TerminalModel.recalculateActive(new Set(terminals));
      expect(terminals[0].emitter.emit).toHaveBeenCalledWith("did-change-title", "title 0");
      expect(terminals[1].emitter.emit).toHaveBeenCalledWith("did-change-title", "title 1");
    });
  });
});
