const { normalizeWebglFonts } = require("../lib/webgl-font-compatibility");

describe("Terminal WebGL canvas font compatibility", () => {
  // Exercise both browser behaviors even after Electron fixes the regression.
  class Context {
    constructor(rejectWhitespace = true) {
      this.rejectWhitespace = rejectWhitespace;
      this.value = "10px sans-serif";
    }

    get font() {
      return this.value;
    }

    set font(value) {
      this.lastAssignment = value;
      if (typeof value === "string" && this.rejectWhitespace && /^\s/.test(value)) return;
      this.value = String(value)
        .trim()
        .replace(/^normal /, "");
    }
  }

  function documentFor(rejectWhitespace) {
    return {
      createElement: () => ({ getContext: () => new Context(rejectWhitespace) }),
    };
  }

  function atlas() {
    return { _tmpCtx: new Context(), clearTexture: jasmine.createSpy("clearTexture") };
  }

  it("does not adapt renderers on browsers that already accept leading whitespace", () => {
    const current = atlas();
    const renderer = { _charAtlas: current };
    const original = Object.getOwnPropertyDescriptor(renderer, "_charAtlas");
    const lease = normalizeWebglFonts({ _renderer: renderer }, documentFor(false));
    expect(Object.getOwnPropertyDescriptor(renderer, "_charAtlas")).toEqual(original);
    expect(Object.hasOwn(current._tmpCtx, "font")).toBe(false);
    expect(current.clearTexture).not.toHaveBeenCalled();
    lease.dispose();
  });

  it("normalizes only the atlas context and keeps native font semantics", () => {
    const current = atlas();
    const renderer = { _charAtlas: current };
    const lease = normalizeWebglFonts({ _renderer: renderer }, documentFor(true));
    try {
      const context = current._tmpCtx;
      context.font = " normal 24px monospace";
      expect(context.font).toBe("24px monospace");
      context.font = "italic bold 24px monospace";
      expect(context.font).toBe("italic bold 24px monospace");
      const value = { toString: () => "18px serif" };
      context.font = value;
      expect(context.lastAssignment).toBe(value);
      expect(context.font).toBe("18px serif");
      const unrelated = new Context();
      unrelated.font = " normal 24px monospace";
      expect(unrelated.font).toBe("10px sans-serif");
      expect(Object.hasOwn(Context.prototype, "font")).toBe(true);
      expect(current.clearTexture).toHaveBeenCalledTimes(1);
    } finally {
      lease.dispose();
    }
  });

  it("adapts replacement atlases before their first font assignment", () => {
    const renderer = { _charAtlas: undefined };
    const lease = normalizeWebglFonts({ _renderer: renderer }, documentFor(true));
    try {
      for (let index = 0; index < 3; index++) {
        const current = atlas();
        renderer._charAtlas = current;
        current._tmpCtx.font = ` normal ${20 + index}px monospace`;
        expect(current._tmpCtx.font).toBe(`${20 + index}px monospace`);
        expect(current.clearTexture).toHaveBeenCalledTimes(1);
      }
    } finally {
      lease.dispose();
    }
    const latest = renderer._charAtlas;
    lease.dispose();
    expect(Object.getOwnPropertyDescriptor(renderer, "_charAtlas")).toEqual({
      value: latest,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  });

  it("keeps a shared atlas correct when one of its terminals is disposed", () => {
    const shared = atlas();
    const first = normalizeWebglFonts({ _renderer: { _charAtlas: shared } }, documentFor(true));
    const secondRenderer = { _charAtlas: shared };
    const second = normalizeWebglFonts({ _renderer: secondRenderer }, documentFor(true));
    try {
      first.dispose();
      shared._tmpCtx.font = " normal 28px monospace";
      expect(shared._tmpCtx.font).toBe("28px monospace");
      expect(shared.clearTexture).toHaveBeenCalledTimes(1);
      const replacement = atlas();
      secondRenderer._charAtlas = replacement;
      replacement._tmpCtx.font = " normal 32px monospace";
      expect(replacement._tmpCtx.font).toBe("32px monospace");
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("checks the private xterm boundary explicitly", () => {
    const document = documentFor(true);
    expect(() => normalizeWebglFonts({}, document)).toThrowError(
      "Terminal: Unsupported xterm WebGL atlas binding API.",
    );
    expect(() => normalizeWebglFonts({ _renderer: { _charAtlas: {} } }, document)).toThrowError(
      "Terminal: Unsupported xterm WebGL atlas font API.",
    );
  });
});
