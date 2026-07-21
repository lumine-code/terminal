const Terminal = require("../lib/terminal");
const { Pty } = require("../lib/pty");
const { URL } = require("url");

const { activatePackage, stubPty, wait } = require("./helpers");

const DIV = document.createElement("div");

describe("Terminal", () => {
  beforeEach(async () => {
    jasmine.useRealClock();
    document.getElementById("jasmine-content").style.height = "150px";
    activatePackage();
    await atom.updateProcessEnvAndTriggerHooks();
  });

  describe("unfocus()", () => {
    it("focuses atom-workspace", async () => {
      // Stub the PTY so this focus test doesn't wait on a real node-pty worker.
      stubPty(Pty);
      jasmine.attachToDOM(atom.views.getView(atom.workspace));
      let model = await Terminal.openInCenterOrDock(atom.workspace);
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
      atom.config.set("terminal.behavior.runInActive", false);
      await Terminal.runCommands(commands);
      expect(Terminal.getActiveTerminal).not.toHaveBeenCalled();
      expect(newTerminal.run).toHaveBeenCalledWith("command 1");
      expect(newTerminal.run).toHaveBeenCalledWith("command 2");
    });

    it("runs commands in the active terminal if configured to do so", async () => {
      atom.config.set("terminal.behavior.runInActive", true);
      await Terminal.runCommands(commands);
      expect(Terminal.open).not.toHaveBeenCalled();
      expect(activeTerminal.run).toHaveBeenCalledWith("command 1");
      expect(activeTerminal.run).toHaveBeenCalledWith("command 2");
    });

    it("creates a new terminal if need be, even if configured to reuse terminals", async () => {
      Terminal.getActiveTerminal.and.returnValue();
      atom.config.set("terminal.behavior.runInActive", true);
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
        spyOn(atom.clipboard, "write");
        await Terminal.copy();
        expect(atom.clipboard.write).toHaveBeenCalledWith("copied");
      });
    });

    describe("paste()", () => {
      it("pastes text into the active terminal", async () => {
        spyOn(atom.clipboard, "read").and.returnValue("copied");
        await Terminal.paste();
        expect(activeTerminal.paste).toHaveBeenCalledWith("copied");
      });
    });

    describe("clear()", () => {
      it("clears the active terminal", async () => {
        await Terminal.clear();
        expect(activeTerminal.clear).toHaveBeenCalled();
      });
    });
  });

  describe("open()", () => {
    let uri;
    beforeEach(() => {
      uri = Terminal.generateUri();
      spyOn(atom.workspace, "open");
    });

    it("handles a simple case", async () => {
      await Terminal.open(uri);
      expect(atom.workspace.open).toHaveBeenCalledWith(uri, { location: "center" });
    });

    it("specifies a cwd if a target is given", async () => {
      let testPath = `/test/path`;
      spyOn(Terminal, "getPath").and.returnValue(testPath);
      // `cwd` is appended to the URL, but only if the target is an element.
      // TODO: Does what I just said make any sense?
      await Terminal.open(uri, { target: DIV });

      let url = new URL(atom.workspace.open.calls.argsFor(0)[0]);
      expect(url.searchParams.get("cwd")).toBe(testPath);
    });
  });
});
