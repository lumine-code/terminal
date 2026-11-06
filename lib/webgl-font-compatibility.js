// Electron 45.2.3 rejects leading whitespace in canvas font shorthands.
// xterm's WebGL atlas emits it for non-italic glyphs, leaving the canvas at
// 10px sans-serif while cell measurements still use the configured font.
// https://github.com/electron/electron/issues/55616
// Remove this adapter once the supported runtimes include Chromium's fix:
// https://github.com/chromium/chromium/commit/861cb7cc1d51
const normalizedContexts = new WeakSet();

function rejectsLeadingFontWhitespace(document) {
  const context = document.createElement("canvas").getContext("2d");
  context.font = "23px monospace";
  const expected = context.font;
  context.font = "10px sans-serif";
  context.font = " normal 23px monospace";
  return context.font !== expected;
}

function normalizeAtlas(atlas) {
  if (!atlas) return;
  const context = atlas._tmpCtx;
  if (normalizedContexts.has(context)) return;
  const font = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(context ?? {}), "font");
  if (
    typeof font?.get !== "function" ||
    typeof font?.set !== "function" ||
    typeof atlas.clearTexture !== "function"
  ) {
    throw new Error("Terminal: Unsupported xterm WebGL atlas font API.");
  }
  // This context belongs to an atlas, which xterm may share across terminals.
  // Leave its normalization in place until the atlas itself is collected.
  // No global canvas prototype or unrelated context is modified.
  Object.defineProperty(context, "font", {
    configurable: true,
    get() {
      return font.get.call(this);
    },
    set(value) {
      font.set.call(this, typeof value === "string" ? value.trimStart() : value);
    },
  });
  normalizedContexts.add(context);
  atlas.clearTexture();
}

function normalizeWebglFonts(addon, document) {
  if (!rejectsLeadingFontWhitespace(document)) return { dispose() {} };
  const renderer = addon._renderer;
  const original = Object.getOwnPropertyDescriptor(renderer ?? {}, "_charAtlas");
  if (!original?.configurable || !original.writable) {
    throw new Error("Terminal: Unsupported xterm WebGL atlas binding API.");
  }
  let atlas = original.value;
  normalizeAtlas(atlas);
  // Intercept replacement before xterm warms up or draws the new atlas. Font,
  // palette, DPR and restored WebGL contexts all pass through this assignment.
  Object.defineProperty(renderer, "_charAtlas", {
    configurable: true,
    get() {
      return atlas;
    },
    set(value) {
      normalizeAtlas(value);
      atlas = value;
    },
  });
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      Object.defineProperty(renderer, "_charAtlas", { ...original, value: atlas });
    },
  };
}

module.exports = { normalizeWebglFonts };
