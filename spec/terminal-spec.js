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
