const fs = require("node:fs");
const path = require("node:path");
const { Terminal } = require("@xterm/xterm");
const { bindTerminalScrollbar } = require("../lib/scrollbar-binding");
const { bindTerminalWindow } = require("../lib/window-binding");

describe("Terminal renderer scrollbar ownership", () => {
  let terminal, host, binding, styles, frame;
  const css = fs.readFileSync(path.join(__dirname, "../styles/xterm.css"), "utf8");
  const renderer = () => terminal._core._viewport._scrollableElement;
  const write = (text) => new Promise((resolve) => terminal.write(text, resolve));
  const waitForNeeded = (needed) =>
    window.waitForFrames(() => renderer()._verticalScrollbar.isNeeded() === needed, {
      description: `the actual renderer overflow to become ${needed}`,
    });

  beforeEach(() => {
    jasmine.useRealClock();
    styles = lumine.styles.addStyleSheet(css, { priority: 2000 });
    host = document.createElement("div");
    host.style.cssText = "position:absolute;left:-10000px;top:0;width:400px;height:200px";
    jasmine.attachToDOM(host);
    terminal = new Terminal({ rows: 8, cols: 40 });
    terminal.open(host);
    binding = bindTerminalScrollbar(terminal, host);
  });

  afterEach(() => {
    binding?.dispose();
    terminal?.dispose();
    host?.remove();
    frame?.remove();
    frame = null;
    styles?.dispose();
  });

  it("keeps frozen presence until the resize settle window ends", async () => {
    await write("scrollback\r\n".repeat(30));
    await waitForNeeded(true);
    expect(host.classList.contains("terminal--scrollbar-scrollable")).toBeTrue();
    host.classList.add("terminal--resize-settling");
    terminal.clear();
    await waitForNeeded(false);
    expect(binding.canScroll).toBeFalse();
    expect(host.classList.contains("terminal--scrollbar-scrollable")).toBeTrue();
    host.classList.remove("terminal--resize-settling");
    binding.refresh();
    expect(host.classList.contains("terminal--scrollbar-scrollable")).toBeFalse();
  });

  it("retires overflow callbacks and the presentation class on disposal", async () => {
    binding.dispose();
    const changes = jasmine.createSpy("overflow changes");
    binding = bindTerminalScrollbar(terminal, host, changes);
    await write("scrollback\r\n".repeat(30));
    await waitForNeeded(true);
    expect(changes).toHaveBeenCalledOnceWith(true);
    binding.dispose();
    expect(host.classList.contains("terminal--scrollbar-scrollable")).toBeFalse();
    terminal.clear();
    await waitForNeeded(false);
    binding.refresh();
    expect(changes).toHaveBeenCalledTimes(1);
    expect(binding.canScroll).toBeFalse();
  });

  it("rebinds actual renderer state after adoption without reviving its hide timer", async () => {
    await write("scrollback\r\n".repeat(30));
    await waitForNeeded(true);
    const scrollable = renderer();
    frame = document.createElement("iframe");
    frame.style.cssText = "position:absolute;left:-10000px;top:0;width:500px;height:300px";
    jasmine.attachToDOM(frame);
    const targetDocument = frame.contentDocument;
    const style = targetDocument.createElement("style");
    style.textContent = css;
    targetDocument.head.appendChild(style);
    targetDocument.adoptNode(host);
    targetDocument.body.appendChild(host);
    bindTerminalWindow(terminal, host);
    binding.dispose();
    binding = bindTerminalScrollbar(terminal, host);
    expect(renderer()).toBe(scrollable);
    expect(scrollable._revealOnScroll).toBeFalse();
    const hide = spyOn(scrollable._hideTimeout, "cancelAndSet").and.callThrough();
    terminal.scrollToTop();
    terminal.clear();
    await waitForNeeded(false);
    expect(host.classList.contains("terminal--scrollbar-scrollable")).toBeFalse();
    expect(hide).not.toHaveBeenCalled();
  });
});
