const Terminal = require("../lib/terminal");
const { Config } = require("../lib/config");
const { URL } = require("url");

const { activatePackage, stubPty, wait } = require("./helpers");

const DIV = document.createElement("div");

describe("Terminal", () => {
  beforeEach(async () => {
    jasmine.useRealClock();
    document.getElementById("jasmine-content").style.height = "150px";
    activatePackage();
    await lumine.updateProcessEnvAndTriggerHooks();
  });

  describe("unfocus()", () => {
    it("focuses lumine-workspace", async () => {
      // Stub the PTY so this focus test doesn't wait on a real node-pty worker.
      stubPty();
      jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
      let model = await Terminal.openInCenterOrDock(lumine.workspace);
      await model.ready();
      await model.element.createTerminal();
      // Give the terminal time to start up.
      await wait(500);
      expect(model.element.contains(document.activeElement)).toEqual(true);
      Terminal.unfocus();
      expect(model.element.contains(document.activeElement)).toEqual(false);
      model.destroy();
    });
  });

  describe("runCommands()", () => {
    let activeTerminal, newTerminal, commands;
    beforeEach(() => {
      activeTerminal = {
        element: {
          ready: () => Promise.resolve(),
        },
        run: jasmine.createSpy("activeTerminal.run"),
      };
      commands = ["command 1", "command 2"];
      newTerminal = {
        element: {
          ready: () => Promise.resolve(),
        },
        run: jasmine.createSpy("newTerminal.run"),
      };
      spyOn(Terminal, "getActiveTerminal").and.returnValue(activeTerminal);
      spyOn(Terminal, "open").and.returnValue(newTerminal);
      spyOn(Terminal, "canRunCommands").and.returnValue(Promise.resolve(true));
    });

    it("runs commands in a new terminal if configured to do so", async () => {
      lumine.config.set("terminal.behavior.runInActive", false);
      await Terminal.runCommands(commands);
      expect(Terminal.getActiveTerminal).not.toHaveBeenCalled();
      expect(newTerminal.run).toHaveBeenCalledWith("command 1");
      expect(newTerminal.run).toHaveBeenCalledWith("command 2");
    });

    it("runs commands in the active terminal if configured to do so", async () => {
      lumine.config.set("terminal.behavior.runInActive", true);
      await Terminal.runCommands(commands);
      expect(Terminal.open).not.toHaveBeenCalled();
      expect(activeTerminal.run).toHaveBeenCalledWith("command 1");
      expect(activeTerminal.run).toHaveBeenCalledWith("command 2");
    });

    it("creates a new terminal if need be, even if configured to reuse terminals", async () => {
      Terminal.getActiveTerminal.and.returnValue();
      lumine.config.set("terminal.behavior.runInActive", true);
      await Terminal.runCommands(commands);

      expect(Terminal.getActiveTerminal).toHaveBeenCalled();
      expect(newTerminal.run).toHaveBeenCalledWith("command 1");
      expect(newTerminal.run).toHaveBeenCalledWith("command 2");
    });
  });

  describe("terminal proxy methods", () => {
    let activeTerminal;
    beforeEach(() => {
      activeTerminal = {
        element: {
          ready: () => Promise.resolve(),
        },
        exit: jasmine.createSpy("activeTerminal.exit"),
        restartPtyProcess: jasmine.createSpy("activeTerminal.restartPtyProcess"),
        getSelection: jasmine.createSpy("activeTerminal.copy").and.returnValue("copied"),
        paste: jasmine.createSpy("activeTerminal.paste"),
        cwd: "some-working-directory",
        clear: jasmine.createSpy("activeTerminal.clear"),
      };
      spyOn(Terminal, "getActiveTerminal").and.returnValue(activeTerminal);
    });

    describe("close()", () => {
      it("closes the active terminal", async () => {
        await Terminal.close();
        expect(activeTerminal.exit).toHaveBeenCalled();
      });
    });

    describe("restart()", () => {
      it("restarts the terminal", async () => {
        await Terminal.restart();
        expect(activeTerminal.restartPtyProcess).toHaveBeenCalled();
      });
    });

    describe("copy()", () => {
      it("copies text from the active terminal", async () => {
        spyOn(lumine.clipboard, "write");
        await Terminal.copy();
        expect(lumine.clipboard.write).toHaveBeenCalledWith("copied");
      });
    });

    describe("paste()", () => {
      it("pastes text into the active terminal", async () => {
        spyOn(lumine.clipboard, "read").and.returnValue("copied");
        spyOn(lumine.pasteProviders, "handlePaste");
        await Terminal.paste();
        expect(activeTerminal.paste).toHaveBeenCalledWith("copied");
        // Text is the terminal's own business; the providers exist for what it
        // cannot write to a pty itself.
        expect(lumine.pasteProviders.handlePaste).not.toHaveBeenCalled();
      });

      it("offers the paste to the providers when the clipboard holds no text", async () => {
        spyOn(lumine.clipboard, "read").and.returnValue("");
        spyOn(lumine.pasteProviders, "handlePaste").and.returnValue(true);

        await Terminal.paste();

        let [context] = lumine.pasteProviders.handlePaste.calls.argsFor(0);
        expect(context.target.type).toBe("terminal");
        expect(context.target.model).toBe(activeTerminal);
        expect(context.target.path).toBe("some-working-directory");
        expect(activeTerminal.paste).not.toHaveBeenCalled();
      });

      it("warns when an image on the clipboard goes unclaimed", async () => {
        spyOn(lumine.clipboard, "read").and.returnValue("");
        spyOn(lumine.clipboard, "readImage").and.returnValue({ isEmpty: () => false });
        spyOn(lumine.pasteProviders, "handlePaste").and.returnValue(false);
        spyOn(lumine.notifications, "addWarning");

        await Terminal.paste();

        expect(lumine.notifications.addWarning).toHaveBeenCalled();
      });

      it("stays silent when the clipboard is simply empty", async () => {
        spyOn(lumine.clipboard, "read").and.returnValue("");
        spyOn(lumine.clipboard, "readImage").and.returnValue({ isEmpty: () => true });
        spyOn(lumine.pasteProviders, "handlePaste").and.returnValue(false);
        spyOn(lumine.notifications, "addWarning");

        await Terminal.paste();

        expect(lumine.notifications.addWarning).not.toHaveBeenCalled();
        expect(activeTerminal.paste).not.toHaveBeenCalled();
      });
    });

    describe("clear()", () => {
      it("clears the active terminal", async () => {
        await Terminal.clear();
        expect(activeTerminal.clear).toHaveBeenCalled();
      });
    });
  });

  describe("theme changes", () => {
    it("re-reads its colors when a theme restyles without swapping stylesheets", async () => {
      spyOn(Terminal, "updateTheme");

      // What a theme variant switch looks like: no style sheet is added or
      // removed and the active themes do not change, so this notification is
      // the terminal's only cue that the palette moved.
      await lumine.themes.updateAppearance(() => {});
      // The update is coalesced onto a microtask so it lands in the same task,
      // and so within the cross-fade.
      await null;

      expect(Terminal.updateTheme).toHaveBeenCalled();
    });
  });

  describe("open()", () => {
    let uri;
    beforeEach(() => {
      uri = Terminal.generateUri();
      spyOn(lumine.workspace, "open");
    });

    it("handles a simple case", async () => {
      await Terminal.open(uri);
      expect(lumine.workspace.open).toHaveBeenCalledWith(uri, { location: "center" });
    });

    it("specifies a cwd if a target is given", async () => {
      let testPath = `/test/path`;
      spyOn(Terminal, "getPath").and.returnValue(testPath);
      // `cwd` is appended to the URL, but only if the target is an element.
      // TODO: Does what I just said make any sense?
      await Terminal.open(uri, { target: DIV });

      let url = new URL(lumine.workspace.open.calls.argsFor(0)[0]);
      expect(url.searchParams.get("cwd")).toBe(testPath);
    });
  });

  describe("getPath()", () => {
    function buildTreeView() {
      let treeView = document.createElement("div");
      treeView.classList.add("tree-view");
      let list = document.createElement("ol");
      list.classList.add("tree-view-root", "full-menu", "list-tree");
      treeView.appendChild(list);
      return { treeView, list };
    }

    function buildEntry(list, entryPath, ...classNames) {
      let entry = document.createElement("li");
      entry.classList.add("tree-view-row", "entry", ...classNames);
      entry.getPath = () => entryPath;
      list.appendChild(entry);
      return entry;
    }

    it("reads the clicked tree-view entry rather than the selection", () => {
      let { list } = buildTreeView();
      buildEntry(list, "/project/other.js", "file", "selected");
      let clicked = buildEntry(list, "/project/src/main.js", "file");
      expect(Terminal.getPath(clicked)).toBe("/project/src/main.js");
    });

    it("falls back to the selection when the click missed every row", () => {
      let { treeView, list } = buildTreeView();
      buildEntry(list, "/project/other.js", "file", "selected");
      expect(Terminal.getPath(treeView)).toBe("/project/other.js");
    });

    // A special root's path is a synthetic `special-root://` URI, not a
    // directory a shell can start in.
    it("refuses a special-root section header", () => {
      let { list } = buildTreeView();
      let specialRoot = buildEntry(
        list,
        "special-root://favourites",
        "directory",
        "tree-view-special-root",
      );
      expect(Terminal.getPath(specialRoot)).toBe(null);
    });

    // Tabs are `li.tab`, and the path lives on the title element inside.
    it("reads a tab's path off its title element", () => {
      let tabBar = document.createElement("ul");
      tabBar.classList.add("tab-bar");
      let tab = document.createElement("li");
      tab.classList.add("tab", "active");
      let title = document.createElement("div");
      title.classList.add("title");
      title.dataset.path = "/project/README.md";
      tab.appendChild(title);
      tabBar.appendChild(tab);
      expect(Terminal.getPath(title)).toBe("/project/README.md");
    });

    it("falls back to the first project path when given no target", () => {
      spyOn(lumine.project, "getPaths").and.returnValue(["/project"]);
      expect(Terminal.getPath(null)).toBe("/project");
    });
  });

  describe("the context menu", () => {
    let treeView, list, entry;

    beforeEach(() => {
      treeView = document.createElement("div");
      treeView.classList.add("tree-view");
      list = document.createElement("ol");
      list.classList.add("tree-view-root", "full-menu", "list-tree");
      treeView.appendChild(list);
      entry = document.createElement("li");
      entry.classList.add("tree-view-row", "entry", "file");
      entry.getPath = () => "/project/src/main.js";
      list.appendChild(entry);
    });

    function offersTerminalItems(element) {
      return lumine.contextMenu
        .templateForElement(element)
        .some((item) => item.label === "Terminal");
    }

    function commandsIn(items) {
      return items.flatMap((item) => (item.submenu ? commandsIn(item.submenu) : [item.command]));
    }

    it("offers its items on a tree-view entry", () => {
      expect(offersTerminalItems(entry)).toBe(true);
    });

    // Everything here acts on whatever was right-clicked. A command that
    // ignores the click — focusing the active terminal, closing every terminal
    // — reads as if it applied to the entry under the cursor, and belongs in
    // `Packages > Terminal` instead.
    it("offers only commands that act on what was clicked", () => {
      let terminal = lumine.contextMenu
        .templateForElement(entry)
        .find((item) => item.label === "Terminal");
      expect(
        commandsIn(terminal.submenu).every((command) => command.endsWith("-context-menu")),
      ).toBe(true);
    });

    // The whole point of scoping to an entry: the tree view is a container, and
    // every click inside it walks past the container on its way up.
    it("offers nothing on the empty area of the tree view", () => {
      expect(offersTerminalItems(list)).toBe(false);
      expect(offersTerminalItems(treeView)).toBe(false);
    });

    it("offers nothing on a special-root section header", () => {
      let specialRoot = document.createElement("li");
      specialRoot.classList.add("tree-view-row", "entry", "directory", "tree-view-special-root");
      list.appendChild(specialRoot);
      expect(offersTerminalItems(specialRoot)).toBe(false);
    });

    it("offers nothing while several entries are selected", () => {
      list.classList.remove("full-menu");
      list.classList.add("multi-select");
      expect(offersTerminalItems(entry)).toBe(false);
    });

    it("offers its items on the active tab of a pane whose item has a path", () => {
      // Never attached: `lumine-pane`'s `connectedCallback` wants a model.
      let pane = document.createElement("lumine-pane");
      pane.dataset.activeItemPath = "/project/src/main.js";
      let tabBar = document.createElement("ul");
      tabBar.classList.add("tab-bar");
      pane.appendChild(tabBar);
      let tab = document.createElement("li");
      tab.classList.add("tab", "active");
      tabBar.appendChild(tab);

      expect(offersTerminalItems(tab)).toBe(true);
      // The blank strip past the last tab names no file at all.
      expect(offersTerminalItems(tabBar)).toBe(false);
    });
  });

  describe("the context-menu commands", () => {
    const ENTRY_PATH = "/project/src/main.js";
    let entry;

    beforeEach(() => {
      spyOn(Terminal, "open");

      let treeView = document.createElement("div");
      treeView.classList.add("tree-view");
      let list = document.createElement("ol");
      list.classList.add("tree-view-root", "full-menu", "list-tree");
      treeView.appendChild(list);
      entry = document.createElement("li");
      entry.classList.add("tree-view-row", "entry", "file");
      entry.getPath = () => ENTRY_PATH;
      list.appendChild(entry);
      jasmine.attachToDOM(treeView);
    });

    function lastOpen() {
      let [uri, options] = Terminal.open.calls.mostRecent().args;
      return { cwd: new URL(uri).searchParams.get("cwd"), options };
    }

    // Every one of these must honor the entry that was clicked. Only
    // `terminal:open-context-menu` ever did: the rest were handed the active
    // editor's element and inferred the directory from that instead.
    for (let command of [
      "terminal:open-context-menu",
      "terminal:open-center-context-menu",
      "terminal:open-split-up-context-menu",
      "terminal:open-split-down-context-menu",
      "terminal:open-split-left-context-menu",
      "terminal:open-split-right-context-menu",
      "terminal:open-split-bottom-dock-context-menu",
      "terminal:open-split-left-dock-context-menu",
      "terminal:open-split-right-dock-context-menu",
    ]) {
      it(`opens \`${command}\` in the clicked entry's directory`, () => {
        lumine.commands.dispatch(entry, command);
        expect(lastOpen().cwd).toBe(ENTRY_PATH);
      });
    }

    // The tree view is itself a dock item, so without this the terminal would
    // be split into the sidebar beside the tree.
    it("opens into the workspace center rather than the tree view's dock", () => {
      lumine.commands.dispatch(entry, "terminal:open-context-menu");
      expect(lastOpen().options.location).toBe("center");
    });

    // `lumine.workspace.getPaneContainers()` is heterogeneous: the docks are
    // `Dock`s and answer `getElement()`, the center is a `WorkspaceCenter` and
    // does not — and it comes first, so asking the list for an element threw
    // on every dispatch that was not from the tree view.
    describe("dispatched from an editor", () => {
      let editor;

      beforeEach(async () => {
        jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
        editor = await lumine.workspace.open();
      });

      it("opens in the center for an editor in the workspace center", () => {
        lumine.commands.dispatch(editor.getElement(), "terminal:open-context-menu");
        expect(lastOpen().options.location).toBe("center");
      });

      it("opens in the dock holding the editor it was dispatched from", async () => {
        let dock = lumine.workspace.getBottomDock();
        dock.getActivePane().addItem(editor);
        dock.show();

        lumine.commands.dispatch(editor.getElement(), "terminal:open-context-menu");
        expect(lastOpen().options.location).toBe("bottom");
      });
    });
  });

  describe("deserializeTerminalModel()", () => {
    let serialized;
    beforeEach(() => {
      serialized = { uri: Terminal.generateUri() };
    });

    // The pane that held a terminal is deserialized at startup, long before the
    // package would otherwise activate, so this path only ever calls core APIs
    // that exist on a loaded-but-not-activated package.
    it("activates the package with APIs the editor still has", () => {
      let pack = lumine.packages.getLoadedPackage("terminal");
      spyOn(pack, "activateNow").and.callThrough();
      Terminal.deserializeTerminalModel(serialized);
      expect(pack.activateNow).toHaveBeenCalled();
    });

    it("restores the terminal when the setting is on", () => {
      Config.set("behavior.relaunchTerminalsOnStartup", true);
      let model = Terminal.deserializeTerminalModel(serialized);
      expect(model.sessionId).toBe(new URL(serialized.uri).host);
      expect(Terminal.terminals.has(model)).toBe(true);
      model.destroy();
    });

    it("restores nothing when the setting is off", () => {
      Config.set("behavior.relaunchTerminalsOnStartup", false);
      expect(Terminal.deserializeTerminalModel(serialized)).toBeUndefined();
    });
  });
});
