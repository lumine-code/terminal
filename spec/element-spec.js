// const nodePty = require('node-pty');
const { TerminalElement } = require("../lib/element");
const { TerminalModel } = require("../lib/model");
const { Terminal } = require("@xterm/xterm");
const { Pty, PtyHost } = require("../lib/pty");
const { getConfigSchema } = require("../lib/config");

const { activatePackage, wait } = require("./helpers");

const path = require("path");
const temp = require("@lumine-code/temp");
temp.track();

let createdElements = [];

function createMockStream(name) {
  let stream = jasmine.createSpyObj(name, ["on", "write", "end"]);
  // `PtyHost.send` refuses to write to a stream that has closed, which is how
  // it declines to talk to a worker that has died.
  stream.writable = true;
  let events = new Map();
  stream.on.and.callFake((event, handler) => {
    let handlers = events.get(event) ?? [];
    handlers.push(handler);
    events.set(event, handlers);
    return stream;
  });
  stream._trigger = (event, ...args) => {
    for (let handler of events.get(event) ?? []) handler(...args);
  };
  stream.pipe = () => {
    return stream;
  };
  return stream;
}

function createMockWorkerProcess() {
  let workerProcess = jasmine.createSpyObj("workerProcess", [
    // 'on',
    "kill",
  ]);
  workerProcess.stdin = createMockStream("workerProcess.stdin");
  workerProcess.stdout = createMockStream("workerProcess.stdout");
  workerProcess.stderr = createMockStream("workerProcess.stderr");

  workerProcess.pid = 9;
  workerProcess._events = {};

  workerProcess.on = function (name, handler) {
    this._events[name] ??= [];
    this._events[name].push(handler);
  };

  workerProcess._trigger = function (name, ...args) {
    for (let handler of this._events[name] ?? []) {
      handler(...args);
    }
  };

  workerProcess._reset = function () {
    this._events = {};
  };
  // Match the real worker's startup handshake after PtyHost has attached its
  // stdout listener. Leaving this unresolved creates a real five-second boot
  // timeout even when a spec stubs `whenBooted`, polluting the test console
  // with unhandled rejections after otherwise successful specs.
  queueMicrotask(() => workerProcess.stdout._trigger("data", { type: "ready", payload: null }));
  return workerProcess;
}

describe("TerminalElement", () => {
  let savedPlatform = process.platform;
  let element, tmpdir;

  async function createElement(uri = `terminal://some-session-id/`) {
    let terminals = new Set();
    let model = new TerminalModel({ uri, terminals });
    await model.ready();
    model.pane = jasmine.createSpyObj("pane", ["removeItem", "getActiveItem", "destroyItem"]);

    let terminalElement = TerminalElement.create();
    await terminalElement.initialize(model);
    await terminalElement.createTerminal();
    document.getElementById("jasmine-content").appendChild(terminalElement);
    createdElements.push(terminalElement);
    return terminalElement;
  }

  beforeEach(async () => {
    jasmine.useRealClock();
    await activatePackage();
    await lumine.updateProcessEnvAndTriggerHooks();

    let ptyProcess = jasmine.createSpyObj("ptyProcess", [
      "kill",
      "write",
      "resize",
      "on",
      "removeAllListeners",
    ]);
    ptyProcess.title = "some-test-process";
    // Each spec observes its own host; the shared one otherwise survives from
    // whichever spec booted it first.
    PtyHost.releaseShared();
    spyOn(PtyHost.prototype, "spawn").and.callFake(() => {
      return createMockWorkerProcess();
    });
    spyOn(Pty.prototype, "ready").and.returnValue(Promise.resolve());
    spyOn(Pty.prototype, "kill").and.returnValue(undefined);
    spyOn(lumine.shell, "openExternal");
    element = await createElement();
    tmpdir = await temp.mkdir();

    // These specs trigger lots of creations and destructions of elements in a
    // short period of time. This can trigger distracting terminal errors as
    // idle callbacks run for elements that have been detached. This doesn't
    // affect the outcome, but it is still annoying.
    //
    // Introducing a brief pause in between specs helps avoid this.
    await wait(50);
  });

  afterEach(async () => {
    // Pause for a tick so that we're not creating and destroying this
    // element in the same frame.
    await wait(0);
    while (createdElements.length) {
      let el = createdElements.shift();
      el.destroy();
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
    Object.defineProperty(process, "platform", {
      value: savedPlatform,
    });
    await temp.cleanup();
  });

  it("initializes", () => {
    expect(element.terminal).toBeTruthy();
  });

  // The worker process behind a running terminal can die on its own — a crash
  // inside `node-pty`, or its own uncaught-exception handler. `onExit` cannot
  // report that: it describes a shell that exited through the worker, which a
  // worker that is gone can no longer do.
  describe("when the worker process dies", () => {
    it("says so and stops claiming to be running", async () => {
      spyOn(lumine.notifications, "addError");
      expect(element.isPtyProcessRunning()).toBeTruthy();

      element.pty.process._trigger("exit", 1, null);
      await wait(0);

      expect(lumine.notifications.addError).toHaveBeenCalled();
      let [message] = lumine.notifications.addError.calls.mostRecent().args;
      expect(message).toContain("exited unexpectedly");
      expect(element.isPtyProcessRunning()).toBeFalsy();
    });

    // A crash loop is invisible if each crash quietly starts another shell, and
    // the scrollback of the session that died is worth keeping on screen.
    it("does not restart the shell by itself", async () => {
      spyOn(element, "restartPtyProcess");

      element.pty.process._trigger("exit", 1, null);
      await wait(0);

      expect(element.restartPtyProcess).not.toHaveBeenCalled();
    });
  });

  it("initializes with the correct session ID", () => {
    expect(element.getAttribute("session-id")).toBe("some-session-id");
  });

  describe("destroy()", () => {
    it("kills the pty", () => {
      element.destroy();
      expect(element.pty.kill).toHaveBeenCalled();
    });

    it("destroys the terminal", () => {
      spyOn(element.terminal, "dispose").and.callThrough();
      element.destroy();
      expect(element.terminal.dispose).toHaveBeenCalled();
    });

    it("disposes subscriptions", () => {
      spyOn(element.subscriptions, "dispose").and.callThrough();
      element.destroy();
      expect(element.subscriptions.dispose).toHaveBeenCalled();
    });

    it("does not refresh the renderer after disposal", async () => {
      let errors = [];
      let recordError = (event) => errors.push(event.error);
      window.addEventListener("error", recordError);
      try {
        element.destroy();
        // Ligature teardown schedules rendering through requestAnimationFrame.
        // Let that frame and the one after it run before checking the result.
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      } finally {
        window.removeEventListener("error", recordError);
      }
      expect(errors).toEqual([]);
    });
  });

  describe("pathIsDirectory()", () => {
    it("returns false when path omitted", async () => {
      expect(await element.pathIsDirectory()).toBe(false);
    });

    it("returns false when path is undefined", async () => {
      expect(await element.pathIsDirectory(undefined)).toBe(false);
    });

    it("returns false when path is null", async () => {
      expect(await element.pathIsDirectory(null)).toBe(false);
    });

    it("returns false when path is nonexistent directory", async () => {
      let isDirectory = await element.pathIsDirectory(path.join(tmpdir, "non-existent-dir"));
      expect(isDirectory).toBe(false);
    });

    it("returns true when path is temp directory", async () => {
      let isDirectory = await element.pathIsDirectory(tmpdir);
      expect(isDirectory).toBe(true);
    });
  });

  it("getCwd() returns the correct cwd", async () => {
    element.model.cwd = tmpdir;
    expect(await element.getCwd()).toBe(tmpdir);
  });

  describe("createTerminal()", () => {
    it("creates a terminal object", () => {
      expect(element.terminal).toBeTruthy();
    });

    it("creates a pty instance", () => {
      expect(element.pty).toBeTruthy();
    });

    // The worker is booted at the top of `#createTerminal` so its startup runs
    // alongside xterm's, and `restartPtyProcess` adopts it rather than booting
    // a second one. Two workers here would mean the head start was thrown away
    // and a ~100MB process leaked with it.
    it("boots exactly one worker for the terminal it creates", () => {
      expect(PtyHost.prototype.spawn.calls.count()).toBe(1);
      expect(element.pty.launched).toBe(true);
    });
  });

  describe("getExtraXTermOptions()", () => {
    it("passes along values defined in the package config", () => {
      lumine.config.set("terminal.xterm.additionalOptions", `{ "foo": false }`);
      expect(element.getExtraXTermOptions()).toEqual({ foo: false });
    });

    it("notifies the user when the config field is invalid JSON", () => {
      spyOn(lumine.notifications, "addError").and.callThrough();
      lumine.config.set("terminal.xterm.additionalOptions", `{ "foo": false`);
      expect(element.getExtraXTermOptions()).toEqual({});
      expect(lumine.notifications.addError).toHaveBeenCalled();
    });
  });

  describe("getOverviewRulerOptions()", () => {
    // `overviewRuler.width` governs the xterm scrollbar width, so it should
    // track whatever width the active theme gives the editor's native
    // scrollbars rather than a hard-coded value.
    it("sizes the scrollbar to match the editor's native scrollbar width", () => {
      let probe = document.createElement("div");
      probe.style.cssText =
        "position: absolute; top: -9999px; width: 100px; height: 100px; overflow: scroll;";
      element.appendChild(probe);
      let editorScrollbarWidth = probe.offsetWidth - probe.clientWidth;
      probe.remove();

      let { width } = element.getOverviewRulerOptions();
      if (editorScrollbarWidth > 0) {
        expect(width).toBe(editorScrollbarWidth);
      } else {
        // Overlay scrollbars (e.g. macOS) reserve no width; the terminal falls
        // back to a sensible default so the scrollbar stays usable.
        expect(width).toBeGreaterThan(0);
      }
    });
  });

  describe("getEnv()", () => {
    it("advertises truecolor support", () => {
      expect(element.getEnv().COLORTERM).toBe("truecolor");
    });

    it("lets the delete list remove COLORTERM", () => {
      lumine.config.set("terminal.terminal.env.deleteEnv", ["COLORTERM"]);
      expect(element.getEnv().COLORTERM).toBe(undefined);
    });
  });

  describe("getXtermOptions()", () => {
    it("uses a steady cursor", () => {
      expect(element.getXtermOptions().cursorBlink).toBe(false);
    });

    it("keeps text readable against application-defined cell backgrounds", () => {
      expect(element.getXtermOptions().minimumContrastRatio).toBe(4.5);
    });

    it("applies the configured scrollback", () => {
      lumine.config.set("terminal.xterm.scrollback", 4321);
      expect(element.getXtermOptions().scrollback).toBe(4321);
    });

    it("lets additionalOptions override scrollback", () => {
      lumine.config.set("terminal.xterm.additionalOptions", `{ "scrollback": 99 }`);
      expect(element.getXtermOptions().scrollback).toBe(99);
    });

    it("lets additionalOptions override the minimum contrast ratio", () => {
      lumine.config.set("terminal.xterm.additionalOptions", `{ "minimumContrastRatio": 1 }`);
      expect(element.getXtermOptions().minimumContrastRatio).toBe(1);
    });
  });

  describe("showNotification()", () => {
    it("is gated by behavior.showNotifications, except when forced", () => {
      spyOn(lumine.notifications, "addInfo");
      element.showNotification("hello", "info");
      expect(lumine.notifications.addInfo).toHaveBeenCalled();

      lumine.notifications.addInfo.calls.reset();
      lumine.config.set("terminal.behavior.showNotifications", false);
      element.showNotification("hello", "info");
      expect(lumine.notifications.addInfo).not.toHaveBeenCalled();

      element.showNotification("hello", "info", { force: true });
      expect(lumine.notifications.addInfo).toHaveBeenCalled();
    });
  });

  describe("updateTheme()", () => {
    it("does not offer the retired Atom presets", () => {
      const values = getConfigSchema().appearance.properties.theme.enum.map((entry) =>
        typeof entry === "string" ? entry : entry.value,
      );
      expect(values).not.toContain("Atom Dark");
      expect(values).not.toContain("Atom Light");
    });

    it("repaints when the resolved colors change", () => {
      lumine.config.set("terminal.appearance.theme", "Base16 Tomorrow Dark");
      element.updateTheme();
      expect(element.terminal.options.theme.background).toBe("#1d1f21");

      lumine.config.set("terminal.appearance.theme", "Base16 Tomorrow Light");
      element.updateTheme();
      expect(element.terminal.options.theme.background).toBe("#ffffff");
      expect(element.style.backgroundColor).toBe("rgb(255, 255, 255)");
    });

    it("leaves the glyph atlas alone when nothing moved", () => {
      lumine.config.set("terminal.appearance.theme", "Base16 Tomorrow Dark");
      element.updateTheme();

      spyOn(element, "setMainBackgroundColor").and.callThrough();
      element.updateTheme();
      // Reapplying would also reassign `options.theme`, which makes xterm throw
      // away its glyph atlas and repaint the whole viewport.
      expect(element.setMainBackgroundColor).not.toHaveBeenCalled();
    });
  });

  describe("createTerminal() addon", () => {
    const { WebLinksAddon } = require("@xterm/addon-web-links");
    const { WebglAddon } = require("@xterm/addon-webgl");
    const { ImageAddon } = require("@xterm/addon-image");

    beforeEach(() => {
      spyOn(Terminal.prototype, "loadAddon").and.callThrough();
    });

    afterEach(() => {
      Terminal.prototype.loadAddon.calls.reset();
    });

    describe("web-links", () => {
      it("is enabled if configured as such", async () => {
        lumine.config.set("terminal.xterm.webLinks", true);
        await createElement();
        let wasAdded = Terminal.prototype.loadAddon.calls.all().some((call) => {
          return call.args[0] instanceof WebLinksAddon;
        });
        expect(wasAdded).toBe(true);
      });

      it("is disabled if configured as such", async () => {
        lumine.config.set("terminal.xterm.webLinks", false);
        await createElement();
        let wasAdded = Terminal.prototype.loadAddon.calls.all().some((call) => {
          return call.args[0] instanceof WebLinksAddon;
        });
        expect(wasAdded).toBe(false);
      });
    });

    describe("webgl", () => {
      it("is enabled if configured as such", async () => {
        lumine.config.set("terminal.xterm.webgl", true);
        await createElement();
        let wasAdded = Terminal.prototype.loadAddon.calls.all().some((call) => {
          return call.args[0] instanceof WebglAddon;
        });
        expect(wasAdded).toBe(true);
      });

      it("is disabled if configured as such", async () => {
        lumine.config.set("terminal.xterm.webgl", false);
        await createElement();
        let wasAdded = Terminal.prototype.loadAddon.calls.all().some((call) => {
          return call.args[0] instanceof WebglAddon;
        });
        expect(wasAdded).toBe(false);
      });
    });

    describe("images", () => {
      function loadedImageAddon() {
        let call = Terminal.prototype.loadAddon.calls
          .all()
          .find((call) => call.args[0] instanceof ImageAddon);
        return call?.args[0];
      }

      it("is enabled if configured as such", async () => {
        lumine.config.set("terminal.xterm.images", true);
        await createElement();
        expect(loadedImageAddon()).not.toBeUndefined();
      });

      it("is disabled if configured as such", async () => {
        lumine.config.set("terminal.xterm.images", false);
        await createElement();
        expect(loadedImageAddon()).toBeUndefined();
      });

      it("takes its storage limit from the config", async () => {
        lumine.config.set("terminal.xterm.images", true);
        lumine.config.set("terminal.xterm.imageStorageLimit", 42);
        await createElement();
        expect(loadedImageAddon().storageLimit).toBe(42);
      });

      it("follows the storage limit as it changes", async () => {
        lumine.config.set("terminal.xterm.images", true);
        lumine.config.set("terminal.xterm.imageStorageLimit", 42);
        await createElement();
        lumine.config.set("terminal.xterm.imageStorageLimit", 8);
        expect(loadedImageAddon().storageLimit).toBe(8);
      });
    });
  });

  describe("restartPtyProcess()", () => {
    it("creates a new pty instance", async () => {
      let oldPty = element.pty;
      await element.restartPtyProcess();
      expect(element.pty).not.toBe(oldPty);
    });

    it('sets the "running" flag to true', async () => {
      expect(element.isPtyProcessRunning()).toBe(true);
      let promise = element.restartPtyProcess();
      expect(element.isPtyProcessRunning()).toBe(false);
      await promise;
      expect(element.isPtyProcessRunning()).toBe(true);
    });

    // Left unset, node-pty spawns the shell at 80x30. The shell then writes its
    // first output at a width the terminal does not have, and the refit that
    // follows makes conpty reflow what it just printed — visible as the text
    // flickering the moment it arrives.
    it("spawns the shell at the size the terminal already is", async () => {
      let launched;
      spyOn(Pty.prototype, "launch").and.callFake(function (options) {
        launched = options;
        this.launched = true;
        return Promise.resolve();
      });

      await element.restartPtyProcess();

      expect(launched.options.cols).toBe(element.terminal.cols);
      expect(launched.options.rows).toBe(element.terminal.rows);
    });

    it("uses the bundled ConPTY on Windows", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      let launched;
      spyOn(Pty.prototype, "launch").and.callFake(function (options) {
        launched = options;
        this.launched = true;
        return Promise.resolve();
      });

      await element.restartPtyProcess();

      expect(launched.options.useConptyDll).toBe(true);
    });

    // No spec for a nonexistent shell: `node-pty`'s spawn resolves for a
    // command that does not exist rather than reporting a launch failure, so
    // there is nothing for the element to notice and nothing to notify about.
    // Restoring this needs the failure surfaced by node-pty first.
  });

  // ConPTY repaints the whole screen after every resize, and that repaint
  // reaches the element as several worker messages: the erase arrives ahead of
  // the redrawn content, so writing each chunk as it landed made the text
  // blink out and back on every reflow. The element instead holds the output
  // that follows a resize and writes it as one batch wrapped in DEC mode 2026
  // (synchronized output), which xterm paints in a single frame.
  describe("resize repaint hold", () => {
    // Shrinks the terminal's geometry so `refitTerminal()` sends a genuine PTY
    // resize. The refit's guards (visibility, a measured content rect) settle
    // asynchronously via observers, so keep trying briefly.
    async function triggerPtyResize() {
      let resize = spyOn(element.pty, "resize");
      element.terminal.options.fontSize += 6;
      for (let i = 0; i < 40 && !resize.calls.count(); i++) {
        element.refitTerminal();
        if (!resize.calls.count()) await wait(25);
      }
      expect(resize).toHaveBeenCalled();
    }

    it("writes output straight through when no resize is pending", async () => {
      // Element creation leaves a debounced PTY resize — and so possibly a
      // repaint hold — pending; let both settle before asserting on the
      // direct path.
      await wait(800);
      let write = spyOn(element.terminal, "write");
      element.pty.emitter.emit("data", "plain output");
      expect(write).toHaveBeenCalledWith("plain output");
    });

    it("batches the output that follows a resize into one synchronized write", async () => {
      await triggerPtyResize();
      let write = spyOn(element.terminal, "write");

      // The repaint arrives as separate messages: erase first, content later.
      element.pty.emitter.emit("data", "\x1b[2J");
      element.pty.emitter.emit("data", "repainted screen");
      expect(write).not.toHaveBeenCalled();

      // The batch closes on the first quiet gap in the stream.
      for (let i = 0; i < 40 && !write.calls.count(); i++) await wait(25);
      expect(write).toHaveBeenCalledTimes(1);
      expect(write.calls.argsFor(0)[0]).toBe("\x1b[?2026h\x1b[2Jrepainted screen\x1b[?2026l");
    });
  });
});

describe("Pty", () => {
  let workerProcesses;

  function spawnMessages(workerProcess) {
    return workerProcess.stdin.write.calls
      .allArgs()
      .map(([raw]) => JSON.parse(raw))
      .filter((message) => message.type === "spawn");
  }

  beforeEach(() => {
    jasmine.useRealClock();
    workerProcesses = [];
    PtyHost.releaseShared();
    spyOn(PtyHost.prototype, "spawn").and.callFake(() => {
      let workerProcess = createMockWorkerProcess();
      workerProcesses.push(workerProcess);
      return workerProcess;
    });
    spyOn(Pty.prototype, "ready").and.returnValue(Promise.resolve());
  });

  afterEach(() => {
    PtyHost.releaseShared();
  });

  // Booting a host costs a whole Node startup and depends on nothing about the
  // shell, so a caller must be able to pay it before it knows the cwd or the
  // environment.
  it("attaches to a host without being told which shell to run", async () => {
    let pty = new Pty();
    await pty.booted();
    expect(PtyHost.prototype.spawn).toHaveBeenCalled();
    expect(pty.launched).toBe(false);
    expect(spawnMessages(workerProcesses[0]).length).toBe(0);
  });

  it("asks for the shell when ::launch is called", async () => {
    let pty = new Pty();
    await pty.launch({ file: "sh", args: [], options: {} });
    expect(pty.launched).toBe(true);
    let [spawned] = spawnMessages(workerProcesses[0]);
    expect(spawned.payload.file).toBe("sh");
    // Every message carries the session it belongs to, which is what lets one
    // worker serve several terminals.
    expect(spawned.id).toBe(pty.id);
  });

  // `start` decides whether to launch the shell it was constructed with only
  // after awaiting the boot, by which point a caller may have launched one
  // itself. Asking twice runs two shells inside the one terminal, which reads
  // as the output arriving doubled and landing in the wrong places.
  it("runs one shell when ::launch races the boot it was constructed with", async () => {
    let pty = new Pty({ file: "sh", args: [], options: {} });
    await pty.launch({ file: "sh", args: [], options: {} });
    // Let `start` resume past its own await and reach its launch decision.
    await null;
    await null;

    expect(spawnMessages(workerProcesses[0]).length).toBe(1);
  });

  describe("host sharing", () => {
    it("runs every session on one worker by default", async () => {
      let first = new Pty();
      let second = new Pty();
      await Promise.all([first.booted(), second.booted()]);

      expect(workerProcesses.length).toBe(1);
      expect(first.host).toBe(second.host);
      expect(first.id).not.toBe(second.id);
    });

    it("gives a session its own worker when asked", async () => {
      let shared = new Pty();
      let isolated = new Pty(undefined, { dedicated: true });
      await Promise.all([shared.booted(), isolated.booted()]);

      expect(workerProcesses.length).toBe(2);
      expect(isolated.host).not.toBe(shared.host);
    });

    // Killing one terminal must leave the others alone, which is the whole
    // hazard of sharing a process between them.
    it("keeps the shared worker alive when one session is killed", async () => {
      let first = new Pty();
      let second = new Pty();
      await Promise.all([first.launch({ file: "sh" }), second.launch({ file: "sh" })]);

      first.kill();

      expect(first.host.destroyed).toBe(false);
      expect(workerProcesses[0].stdin.end).not.toHaveBeenCalled();
      expect(second.host.destroyed).toBe(false);
    });

    // A worker of its own has nothing left to do once its one session is gone,
    // and the worker only exits when its stdin closes.
    it("ends a dedicated worker once its session is killed", async () => {
      let pty = new Pty(undefined, { dedicated: true });
      await pty.launch({ file: "sh" });

      pty.kill();

      expect(pty.host.destroyed).toBe(true);
      expect(workerProcesses[0].stdin.end).toHaveBeenCalled();
    });

    it("ends the shared worker when it is released", async () => {
      let pty = new Pty();
      await pty.booted();

      PtyHost.releaseShared();

      expect(pty.host.destroyed).toBe(true);
      expect(workerProcesses[0].stdin.end).toHaveBeenCalled();
    });
  });

  // A worker can die on its own; `error` on the child process covers only a
  // spawn that never happened. A host that does not notice goes on reporting
  // itself as booted, and every terminal opened afterwards writes its `spawn`
  // into a closed stdin and waits out the readiness timeout instead.
  describe("a worker that dies", () => {
    it("stops being handed to new sessions", async () => {
      let pty = new Pty();
      await pty.booted();
      expect(PtyHost.hasShared()).toBe(true);

      pty.process._trigger("exit", 1, null);

      expect(pty.host.destroyed).toBe(true);
      expect(PtyHost.hasShared()).toBe(false);

      let next = new Pty();
      await next.booted();
      expect(workerProcesses.length).toBe(2);
      expect(next.host).not.toBe(pty.host);
    });

    it("tells every session running on it", async () => {
      let first = new Pty();
      let second = new Pty();
      await Promise.all([first.booted(), second.booted()]);
      let errors = [];
      first.onError((error) => errors.push(error));
      second.onError((error) => errors.push(error));

      first.process._trigger("exit", 1, null);

      expect(errors.length).toBe(2);
      expect(errors[0].message).toContain("code 1");
    });

    // The worker's crash handler writes its diagnostic to stderr and exits at
    // once, so this is the only account of what went wrong.
    it("reports what the worker wrote before it died", async () => {
      let pty = new Pty();
      await pty.booted();
      let error;
      pty.onError((e) => (error = e));

      pty.process.stderr._trigger("data", {
        type: "stderr",
        payload: '{"message":"read EIO"}',
      });
      pty.process._trigger("exit", 1, null);

      expect(error.message).toContain("read EIO");
    });

    // Deliberate teardown ends the process too, and has nothing to report.
    it("stays quiet when the host was ended on purpose", async () => {
      let pty = new Pty();
      await pty.booted();
      let errors = [];
      pty.onError((error) => errors.push(error));

      PtyHost.releaseShared();
      pty.process._trigger("exit", 0, null);

      expect(errors.length).toBe(0);
    });
  });

  // `node-pty` leaves the shell's children running on Windows, so killing a
  // session has to sweep them itself.
  describe("killing a session on Windows", () => {
    let savedPlatform = process.platform;

    beforeEach(() => {
      Object.defineProperty(process, "platform", { value: "win32" });
    });

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: savedPlatform });
    });

    async function launchedPty(pid = 4242) {
      let pty = new Pty();
      await pty.launch({ file: "cmd.exe" });
      // What the shell reports once it is running, and the root of the tree
      // the sweep is about.
      pty.meta.pid = pid;
      return pty;
    }

    // A program that spawns its own helpers leaves more than one level behind,
    // which is as much as enumerating the shell's own children ever reached.
    it("takes the whole tree beneath the shell", async () => {
      let pty = await launchedPty();
      spyOn(pty, "spawn").and.returnValue({ on: () => {} });

      pty.kill();

      let [command, args] = pty.spawn.calls.mostRecent().args;
      expect(command).toBe("taskkill");
      expect(args).toContain("/T");
      expect(args).toContain("4242");
    });

    it("leaves the tree alone on every other platform", async () => {
      let pty = await launchedPty();
      Object.defineProperty(process, "platform", { value: "linux" });
      spyOn(pty, "spawn");

      pty.kill();

      expect(pty.spawn).not.toHaveBeenCalled();
    });

    // Without a shell there is no tree, and a sweep with no root is a
    // `taskkill` aimed at nothing.
    it("sweeps nothing when the shell never reported a pid", async () => {
      let pty = await launchedPty();
      delete pty.meta.pid;
      spyOn(pty, "spawn");

      pty.kill();

      expect(pty.spawn).not.toHaveBeenCalled();
    });

    // How the absence of `wmic` used to arrive, before it was replaced.
    it("survives a sweep that cannot be spawned", async () => {
      let pty = await launchedPty();
      spyOn(pty, "spawn").and.throwError("ENOENT");

      expect(() => pty.kill()).not.toThrow();
      expect(pty.destroyed).toBe(true);
    });
  });
});
