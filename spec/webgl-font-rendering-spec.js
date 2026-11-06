const { Terminal } = require("@xterm/xterm");
const { WebglAddon } = require("@xterm/addon-webgl");
const { normalizeWebglFonts } = require("../lib/webgl-font-compatibility");

function write(terminal, text) {
  return new Promise((resolve) => terminal.write(text, resolve));
}

function render(terminal) {
  return new Promise((resolve) => {
    const subscription = terminal.onRender(() => {
      subscription.dispose();
      resolve();
    });
    terminal.refresh(0, terminal.rows - 1);
  });
}

// Measure actual pixels with an independent, canonical CSS font declaration.
// Reading options or the atlas's font string cannot detect a rejected canvas
// font assignment: the cell grid can be correct while every glyph stays 10px.
function referenceGlyphSize(font, char) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  context.font = font;
  context.fillStyle = "white";
  context.fillText(char, 32, 128);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let left = canvas.width;
  let right = -1;
  let top = canvas.height;
  let bottom = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3] > 0) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  return { x: right - left + 1, y: bottom - top + 1 };
}

describe("WebGL font rendering", () => {
  let terminal, addon, compatibility, container;

  beforeEach(() => {
    jasmine.useRealClock();
    container = document.createElement("div");
    container.style.cssText = "position: fixed; left: 0; top: 0; width: 800px; height: 300px";
    document.getElementById("jasmine-content").appendChild(container);
    terminal = new Terminal({
      allowProposedApi: true,
      cols: 20,
      rows: 5,
      fontFamily: "monospace",
      fontSize: 24,
      fontWeight: "normal",
      fontWeightBold: "bold",
      customGlyphs: false,
      theme: { foreground: "#ffffff", background: "#000000" },
    });
    terminal.open(container);
    addon = new WebglAddon();
    terminal.loadAddon(addon);
    compatibility = normalizeWebglFonts(addon, document);
  });

  afterEach(() => {
    compatibility?.dispose();
    terminal?.dispose();
    container?.remove();
  });

  async function expectRenderedFonts(target = terminal, targetAddon = addon) {
    await write(target, "\x1b[H\x1b[0mH\r\n\x1b[1mH\r\n\x1b[0;3mH\x1b[0m");
    await render(target);
    const renderer = targetAddon._renderer;
    const atlas = renderer._charAtlas;
    expect(atlas).toBeTruthy();
    expect(renderer._gl.isContextLost()).toBe(false);
    const config = atlas._config;
    const size = target.options.fontSize * config.devicePixelRatio;
    for (const [row, style] of [
      [0, "normal"],
      [1, "bold"],
      [2, "italic"],
    ]) {
      const cell = target.buffer.active.getLine(row).getCell(0);
      const glyph = atlas._cacheMap.get(cell.getCode(), cell.bg, cell.fg, cell.extended.ext);
      expect(glyph).toBeTruthy();
      const reference = referenceGlyphSize(`${style} ${size}px ${target.options.fontFamily}`, "H");
      // Atlas background removal can discard the faintest antialiasing pixels.
      expect(Math.abs(glyph.size.x - reference.x)).toBeLessThanOrEqual(2);
      expect(Math.abs(glyph.size.y - reference.y)).toBeLessThanOrEqual(2);
    }
    return atlas;
  }

  it("rasterizes regular, bold and italic glyphs at the configured size and family", async () => {
    await expectRenderedFonts();
  });

  it("keeps fonts correct when size, family and theme replace the texture atlas", async () => {
    let previous = await expectRenderedFonts();
    for (const options of [
      { fontSize: 32 },
      { fontFamily: "serif" },
      { theme: { foreground: "#eeeeee", background: "#111111" } },
    ]) {
      terminal.options = options;
      const atlas = await expectRenderedFonts();
      expect(atlas).not.toBe(previous);
      previous = atlas;
    }
  });

  it("rasterizes at the new device pixel ratio after real window zoom", async () => {
    const original = await expectRenderedFonts();
    let zoomed = false;
    try {
      await lumine.window.zoomIn();
      zoomed = true;
      for (let attempts = 0; attempts < 100; attempts++) {
        if (
          addon._renderer._charAtlas._config.devicePixelRatio !== original._config.devicePixelRatio
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const atlas = await expectRenderedFonts();
      expect(atlas).not.toBe(original);
      expect(atlas._config.devicePixelRatio).toBe(window.devicePixelRatio);
      expect(atlas._config.devicePixelRatio).not.toBe(original._config.devicePixelRatio);
    } finally {
      if (zoomed) await lumine.window.zoomOut();
    }
  });

  it("keeps a shared atlas correct after another terminal is disposed", async () => {
    const atlas = await expectRenderedFonts();
    const secondContainer = document.createElement("div");
    container.appendChild(secondContainer);
    const second = new Terminal({ ...terminal.options });
    second.open(secondContainer);
    const secondAddon = new WebglAddon();
    second.loadAddon(secondAddon);
    const secondCompatibility = normalizeWebglFonts(secondAddon, document);
    try {
      expect(await expectRenderedFonts(second, secondAddon)).toBe(atlas);
      compatibility.dispose();
      terminal.dispose();
      compatibility = undefined;
      terminal = undefined;
      secondAddon.clearTextureAtlas();
      expect(await expectRenderedFonts(second, secondAddon)).toBe(atlas);
    } finally {
      secondCompatibility.dispose();
      second.dispose();
    }
  });
});
