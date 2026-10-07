describe("Terminal CSS theme values", () => {
  let themes;
  let config;
  let sheet;
  let background;

  beforeEach(() => {
    background = document.documentElement.style.getPropertyValue(
      "--terminal-internal-operative-background-color",
    );
    themes = require("../lib/themes");
    config = require("../lib/config").Config;
    spyOn(config, "get").and.callFake((key) => (key === "appearance.theme" ? "Stylesheet" : {}));
  });

  afterEach(() => {
    sheet?.dispose();
    if (background)
      document.documentElement.style.setProperty(
        "--terminal-internal-operative-background-color",
        background,
      );
    else
      document.documentElement.style.removeProperty(
        "--terminal-internal-operative-background-color",
      );
  });

  it("resolves relative CSS colors to strings xterm can parse without leaving probes", () => {
    sheet = lumine.styles.addStyleSheet(
      `:root {
      --terminal-text-color: rgb(from rgb(10, 20, 30) calc(r + 5) g b);
      --terminal-color-black: color-mix(in srgb, rgb(1, 2, 3) 100%, white);
      --terminal-result-marker-color: lch(from rgb(50, 60, 70) l c h);
    }`,
      { priority: 2 },
    );
    const children = document.documentElement.children.length;
    const theme = themes.getTheme();
    expect(theme.foreground).toMatch(/^rgba?\(/);
    expect(theme.black).toMatch(/^rgba?\(/);
    const probe = document.createElement("span");
    probe.style.color = theme.foreground;
    jasmine.attachToDOM(probe);
    expect(getComputedStyle(probe).color).toBe("rgb(15, 20, 30)");
    probe.style.color = theme.black;
    expect(getComputedStyle(probe).color).toBe("rgb(1, 2, 3)");
    probe.remove();
    expect(themes.getSearchTheme().matchBorder).toMatch(/^rgba?\(/);
    expect(document.documentElement.children.length).toBe(children);
  });

  it("uses actual UI roles for Standard instead of undefined standard-prefixed names", () => {
    config.get.and.callFake((key) => (key === "appearance.theme" ? "Standard" : {}));
    sheet = lumine.styles.addStyleSheet(
      `:root {
      --app-background-color: rgb(11, 22, 33);
      --text-color: rgb(22, 33, 44);
      --background-color-selected: rgb(33, 44, 55);
      --text-color-selected: rgb(44, 55, 66);
    }`,
      { priority: 2 },
    );
    const theme = themes.getTheme();
    expect(theme.background).toBe("rgb(11, 22, 33)");
    expect(theme.foreground).toBe("rgb(22, 33, 44)");
    expect(theme.selectionBackground).toBe("rgb(33, 44, 55)");
    expect(theme.selectionForeground).toBe("rgb(44, 55, 66)");
    expect(theme.black).toBeUndefined();
  });

  it("preserves configured search colors instead of replacing them with stylesheet values", () => {
    const color = (value) => ({ toRGBAString: () => value });
    config.get.and.callFake((key) =>
      key === "appearance.theme"
        ? "Config"
        : {
            foreground: color("rgb(1, 2, 3)"),
            background: color("rgb(4, 5, 6)"),
            matchBorder: color("rgb(7, 8, 9)"),
            activeMatchBorder: color("rgb(10, 11, 12)"),
            matchBackground: color("rgb(13, 14, 15)"),
            activeMatchBackground: color("rgb(16, 17, 18)"),
          },
    );
    expect(themes.getSearchTheme()).toEqual(
      jasmine.objectContaining({
        matchBorder: "rgb(7, 8, 9)",
        activeMatchBorder: "rgb(10, 11, 12)",
        matchBackground: "rgb(13, 14, 15)",
        activeMatchBackground: "rgb(16, 17, 18)",
      }),
    );
  });

  it("falls back for invalid base colors and leaves undefined ANSI entries to xterm", () => {
    const reader = require("../lib/theme-color-reader")();
    sheet = lumine.styles.addStyleSheet(
      `:root {
      --terminal-background-color: 20px;
      --syntax-background-color: rgb(12, 23, 34);
      --terminal-color-black: not-a-color;
    }`,
      { priority: 2 },
    );
    try {
      expect(themes.getTheme().background).toBe("rgb(12, 23, 34)");
      expect(themes.getTheme().black).toBeUndefined();
      expect(reader.read("--missing-terminal-color")).toBeUndefined();
    } finally {
      reader.destroy();
    }
  });
});
