const fs = require("node:fs");
const os = require("os");
const path = require("path");
const { Terminal } = require("@xterm/xterm");
const { WebLinksAddon } = require("@xterm/addon-web-links");
const { LocalPathLinkProvider } = require("../lib/link-detection/provider");
const {
  AltLinkController,
  getLinkProviders,
} = require("../lib/link-detection/alt-link-controller");
const { wait } = require("./helpers");

const WEB_URI = "https://example.com/";

function write(terminal, text) {
  return new Promise((resolve) => terminal.write(text, resolve));
}

describe("AltLinkController", () => {
  let terminal, container, controller, fixtureDir, providers, originalMethods, links, activate;

  beforeEach(async () => {
    jasmine.useRealClock();
    fixtureDir = await fs.promises.mkdtemp(
      path.join(fs.realpathSync(os.tmpdir()), "terminal-alt-links-"),
    );
    await fs.promises.writeFile(path.join(fixtureDir, "notes.txt"), "notes");
    activate = jasmine.createSpy("activate");
    terminal = new Terminal({
      allowProposedApi: true,
      cols: 80,
      rows: 5,
      altClickMovesCursor: true,
      linkHandler: { allowNonHttpProtocols: true, activate },
    });
    terminal.loadAddon(new WebLinksAddon(activate));
    terminal.registerLinkProvider(new LocalPathLinkProvider(terminal, () => fixtureDir, activate));
    providers = getLinkProviders(terminal);
    links = new Map();
    // Record the public ILink objects received by Linkifier, before wrapping
    // providers. The controller and xterm receive exactly these same objects.
    for (const [index, provider] of providers.entries()) {
      const original = provider.provideLinks;
      provider.provideLinks = function (line, callback) {
        return original.call(this, line, (reply) => {
          callback(reply);
          if (reply?.length) links.set(index, reply);
        });
      };
    }
    originalMethods = providers.map((provider) => provider.provideLinks);
    container = document.createElement("div");
    container.style.cssText = "position: fixed; left: 0; top: 0; width: 800px; height: 200px";
    document.getElementById("jasmine-content").appendChild(container);
    controller = new AltLinkController(terminal, container);
    terminal.open(container);
    await write(
      terminal,
      `${WEB_URI}    plain\r\n\x1b]8;;${WEB_URI}\x07OSC link\x1b]8;;\x07    plain\r\n./notes.txt    plain`,
    );
    await wait(30);
  });

  afterEach(async () => {
    controller.dispose();
    terminal.dispose();
    container.remove();
    await fs.promises.rm(fixtureDir, { recursive: true, force: true });
  });

  function mouse(type, column, row, modifiers = {}) {
    const screen = terminal.element.querySelector(".xterm-screen");
    const rect = screen.getBoundingClientRect();
    screen.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        detail: 1,
        clientX: rect.left + ((column - 0.5) * rect.width) / terminal.cols,
        clientY: rect.top + ((row - 0.5) * rect.height) / terminal.rows,
        ...modifiers,
      }),
    );
  }

  function key(type, modifiers = {}) {
    document.dispatchEvent(new KeyboardEvent(type, { key: "Alt", bubbles: true, ...modifiers }));
  }

  function pointerVisible() {
    return terminal.element
      .querySelector(".xterm-screen")
      .classList.contains("xterm-cursor-pointer");
  }

  function expectDecorations(link, visible) {
    expect(link.decorations.underline).toBe(visible);
    expect(link.decorations.pointerCursor).toBe(visible);
    expect(pointerVisible()).toBe(visible);
  }

  it("finds all three providers without changing their priority order", () => {
    expect(providers.length).toBe(3);
    expect(providers[2] instanceof LocalPathLinkProvider).toBe(true);
    const copy = getLinkProviders(terminal);
    copy.pop();
    expect(getLinkProviders(terminal)).toEqual(providers);
  });

  it("fails explicitly if the installed xterm provider boundary changes", () => {
    expect(() => getLinkProviders({})).toThrowError(
      "Terminal: Unsupported xterm link provider API.",
    );
    expect(() =>
      getLinkProviders({ _core: { _linkProviderService: { linkProviders: [{}] } } }),
    ).toThrowError();
  });

  for (const [name, row, providerIndex] of [
    ["URL", 1, 1],
    ["OSC 8", 2, 0],
    ["local path", 3, 2],
  ]) {
    it(`updates the stationary ${name} link immediately on Alt press, release and press again`, async () => {
      mouse("mousemove", 2, row);
      await wait(30);
      const link = links.get(providerIndex)?.[0];
      expect(link).toBeDefined();
      expectDecorations(link, false);
      key("keydown", { altKey: true });
      expectDecorations(link, true);
      key("keyup");
      expectDecorations(link, false);
      key("keydown", { altKey: true });
      expectDecorations(link, true);
    });

    it(`opens the ${name} once on Alt-left-click without emitting cursor movement`, async () => {
      const data = jasmine.createSpy("data");
      terminal.onData(data);
      mouse("mousemove", 2, row, { altKey: true });
      await wait(30);
      mouse("mousedown", 2, row, { altKey: true });
      expect(terminal.options.altClickMovesCursor).toBe(false);
      mouse("mouseup", 2, row, { altKey: true });
      await wait(0);
      expect(activate).toHaveBeenCalledTimes(1);
      expect(data).not.toHaveBeenCalled();
      expect(terminal.options.altClickMovesCursor).toBe(true);
    });

    it(`keeps ordinary and Ctrl/Cmd clicks on the ${name} inactive`, async () => {
      for (const modifiers of [{}, { ctrlKey: true }, { metaKey: true }]) {
        mouse("mousemove", 2, row, modifiers);
        await wait(30);
        expectDecorations(links.get(providerIndex)[0], false);
        mouse("mousedown", 2, row, modifiers);
        mouse("mouseup", 2, row, modifiers);
      }
      expect(activate).not.toHaveBeenCalled();
      expect(terminal.options.altClickMovesCursor).toBe(true);
    });
  }

  it("restores current Alt decorations when a cached link is entered again on the same row", async () => {
    mouse("mousemove", 2, 1, { altKey: true });
    await wait(30);
    expect(pointerVisible()).toBe(true);
    mouse("mousemove", 30, 1, { altKey: true });
    expect(pointerVisible()).toBe(false);
    key("keyup");
    mouse("mousemove", 2, 1);
    expectDecorations(links.get(1)[0], false);
    key("keydown", { altKey: true });
    expectDecorations(links.get(1)[0], true);
    mouse("mousemove", 30, 1, { altKey: true });
    mouse("mousemove", 2, 1, { altKey: true });
    expectDecorations(links.get(1)[0], true);
  });

  it("moves decorations between links and removes them over plain text", async () => {
    mouse("mousemove", 2, 1, { altKey: true });
    await wait(30);
    expect(pointerVisible()).toBe(true);
    mouse("mousemove", 2, 2, { altKey: true });
    await wait(30);
    expectDecorations(links.get(0)[0], true);
    mouse("mousemove", 30, 2, { altKey: true });
    expect(pointerVisible()).toBe(false);
  });

  it("clears stationary decorations and restores cursor movement on window blur", async () => {
    mouse("mousemove", 2, 1, { altKey: true });
    await wait(30);
    mouse("mousedown", 2, 1, { altKey: true });
    window.dispatchEvent(new Event("blur"));
    expectDecorations(links.get(1)[0], false);
    expect(terminal.options.altClickMovesCursor).toBe(true);
  });

  it("keeps the hovered link available when keyboard focus changes inside the window", async () => {
    mouse("mousemove", 2, 1);
    await wait(30);
    terminal.textarea.dispatchEvent(new Event("blur"));
    key("keydown", { altKey: true });
    expectDecorations(links.get(1)[0], true);
  });

  it("keeps xterm Alt-click cursor movement over ordinary text", async () => {
    const data = jasmine.createSpy("data");
    terminal.onData(data);
    mouse("mousemove", 30, 3, { altKey: true });
    await wait(30);
    mouse("mousedown", 30, 3, { altKey: true });
    expect(terminal.options.altClickMovesCursor).toBe(true);
    mouse("mouseup", 30, 3, { altKey: true });
    expect(activate).not.toHaveBeenCalled();
    expect(data).toHaveBeenCalled();
  });

  it("keeps cursor movement disabled after leaving during an Alt-link gesture", async () => {
    mouse("mousemove", 2, 1, { altKey: true });
    await wait(30);
    mouse("mousedown", 2, 1, { altKey: true });
    container.dispatchEvent(new MouseEvent("mouseleave"));
    expect(pointerVisible()).toBe(false);
    expect(terminal.options.altClickMovesCursor).toBe(false);
    document.dispatchEvent(new MouseEvent("mouseup", { altKey: true, button: 0 }));
    // A document capture listener must not restore before SelectionService's
    // own mouseup listener has run.
    expect(terminal.options.altClickMovesCursor).toBe(false);
    await wait(0);
    expect(terminal.options.altClickMovesCursor).toBe(true);
  });

  it("preserves a disabled cursor-movement option after an Alt-link gesture", async () => {
    terminal.options.altClickMovesCursor = false;
    mouse("mousemove", 2, 1, { altKey: true });
    await wait(30);
    mouse("mousedown", 2, 1, { altKey: true });
    mouse("mouseup", 2, 1, { altKey: true });
    await wait(0);
    expect(terminal.options.altClickMovesCursor).toBe(false);
  });

  it("leaves ordinary mouse selection available across a link", async () => {
    mouse("mousemove", 2, 1);
    await wait(30);
    mouse("mousedown", 2, 1);
    mouse("mousemove", 10, 1, { buttons: 1 });
    mouse("mouseup", 10, 1);
    expect(terminal.getSelection().length).toBeGreaterThan(1);
    expect(activate).not.toHaveBeenCalled();
  });

  it("restores providers and removes key listeners when disposed, allowing recreation", async () => {
    mouse("mousemove", 2, 1, { altKey: true });
    await wait(30);
    mouse("mousedown", 2, 1, { altKey: true });
    controller.dispose();
    expectDecorations(links.get(1)[0], false);
    expect(terminal.options.altClickMovesCursor).toBe(true);
    expect(providers.map((provider) => provider.provideLinks)).toEqual(originalMethods);
    key("keydown", { altKey: true });
    expect(pointerVisible()).toBe(false);
    controller = new AltLinkController(terminal, container);
    mouse("mousemove", 2, 2);
    await wait(30);
    key("keydown", { altKey: true });
    expectDecorations(links.get(0)[0], true);
  });
});

describe("AltLinkController asynchronous providers", () => {
  let terminal, controller, element, finish, callback, originalLink, originalCallbacks, provider;

  beforeEach(() => {
    element = document.createElement("div");
    document.getElementById("jasmine-content").appendChild(element);
    originalLink = {
      text: WEB_URI,
      range: { start: { x: 1, y: 1 }, end: { x: 20, y: 1 } },
      activate: jasmine.createSpy("activate"),
      hover: jasmine.createSpy("hover"),
      leave: jasmine.createSpy("leave"),
      dispose: jasmine.createSpy("dispose"),
    };
    originalCallbacks = { ...originalLink };
    provider = {
      provideLinks: (_line, done) => {
        finish = done;
      },
    };
    terminal = {
      options: { altClickMovesCursor: true },
      _core: { _linkProviderService: { linkProviders: [provider] } },
    };
    controller = new AltLinkController(terminal, element);
    callback = jasmine.createSpy("callback");
  });

  afterEach(() => {
    controller.dispose();
    element.remove();
  });

  function move(altKey) {
    element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, altKey }));
  }

  it("uses current released Alt state for a delayed reply", () => {
    move(true);
    provider.provideLinks(1, callback);
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Alt" }));
    finish([originalLink]);
    const link = callback.calls.mostRecent().args[0][0];
    expect(link.decorations.underline).toBe(false);
    expect(link.decorations.pointerCursor).toBe(false);
    expect(link.text).toBe(originalLink.text);
    expect(link.range).toBe(originalLink.range);
  });

  for (const event of ["mouseleave", "blur"]) {
    it(`keeps late replies undecorated after ${event}`, () => {
      move(true);
      provider.provideLinks(1, callback);
      (event === "blur" ? window : element).dispatchEvent(new Event(event));
      finish([originalLink]);
      const link = callback.calls.mostRecent().args[0][0];
      expect(link.decorations.underline).toBe(false);
      expect(link.decorations.pointerCursor).toBe(false);
    });
  }

  it("drops replies after disposal", () => {
    provider.provideLinks(1, callback);
    controller.dispose();
    finish([originalLink]);
    expect(callback).not.toHaveBeenCalled();
  });

  it("preserves provider callbacks, their receiver and arguments", () => {
    move(true);
    provider.provideLinks(1, callback);
    finish([originalLink]);
    const link = callback.calls.mostRecent().args[0][0];
    const event = new MouseEvent("mouseup", { altKey: true, button: 0 });
    link.hover(event, WEB_URI);
    link.leave(event, WEB_URI);
    link.activate(event, WEB_URI);
    link.dispose();
    for (const method of ["hover", "leave", "activate"]) {
      expect(originalCallbacks[method]).toHaveBeenCalledOnceWith(event, WEB_URI);
      expect(originalCallbacks[method].calls.mostRecent().object).toBe(originalLink);
    }
    expect(originalCallbacks.dispose).toHaveBeenCalledTimes(1);
  });
});
