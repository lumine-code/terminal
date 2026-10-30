const fs = require("fs");
const path = require("path");

describe("Terminal default CSS palette", () => {
  let defaults, palette, probe;
  beforeEach(() => {
    defaults = lumine.styles.addStyleSheet(
      fs.readFileSync(path.join(__dirname, "../styles/variables.css"), "utf8"),
      { priority: 1000 },
    );
    probe = document.createElement("span");
    jasmine.attachToDOM(probe);
  });
  afterEach(() => {
    palette?.dispose();
    defaults.dispose();
  });

  function color(name) {
    probe.style.color = `var(--${name})`;
    return getComputedStyle(probe).color;
  }

  it("keeps canvas text, selection and cursor in the syntax palette when the UI has the opposite brightness", () => {
    palette = lumine.styles.addStyleSheet(
      `:root {
      --text-color: rgb(10, 10, 10);
      --text-color-highlight: rgb(20, 20, 20);
      --background-color-selected: rgb(240, 240, 240);
      --scrollbar-color: rgb(30, 30, 30);
      --syntax-text-color: rgb(230, 240, 250);
      --syntax-background-color: rgb(1, 2, 3);
      --syntax-selection-color: rgb(40, 50, 60);
      --syntax-cursor-color: rgb(200, 210, 220);
      --scrollbar-color-editor: rgb(100, 110, 120);
    }`,
      { priority: 2000 },
    );
    expect(color("terminal-text-color")).toBe("rgb(230, 240, 250)");
    expect(color("terminal-background-color")).toBe("rgb(1, 2, 3)");
    expect(color("terminal-selection-background-color")).toBe("rgb(40, 50, 60)");
    expect(color("terminal-selection-text-color")).toBe("rgb(230, 240, 250)");
    expect(color("terminal-cursor-color")).toBe("rgb(200, 210, 220)");
    expect(color("terminal-scrollbar-color")).toBe("rgb(100, 110, 120)");
  });

  it("preserves explicit terminal overrides from a theme or user stylesheet", () => {
    palette = lumine.styles.addStyleSheet(
      ":root { --terminal-text-color: rgb(100, 120, 140); --terminal-selection-text-color: rgb(150, 170, 190); }",
      { priority: 2000 },
    );
    expect(color("terminal-text-color")).toBe("rgb(100, 120, 140)");
    expect(color("terminal-selection-text-color")).toBe("rgb(150, 170, 190)");
  });
});

describe("Terminal scrollbar presentation boundary", () => {
  let styles, fixture;

  beforeEach(() => {
    styles = lumine.styles.addStyleSheet(
      fs.readFileSync(path.join(__dirname, "../styles/terminal.css"), "utf8"),
      { priority: 2000 },
    );
    fixture = document.createElement("div");
    fixture.className = "disable-animations";
    fixture.style.cssText = "position:absolute;left:-10000px;top:0;width:400px;height:200px";
    jasmine.attachToDOM(fixture);
  });

  afterEach(() => {
    fixture.remove();
    styles.dispose();
  });

  function mount({ dock = false, nested = false, pane = true } = {}) {
    const terminal = document.createElement("terminal-view");
    const scrollable = document.createElement("div");
    scrollable.className = "xterm-scrollable-element";
    const track = document.createElement("div");
    track.className = "scrollbar vertical invisible";
    scrollable.appendChild(track);
    terminal.appendChild(scrollable);
    let parent = fixture;
    if (dock) {
      const dockElement = document.createElement("lumine-dock");
      parent.appendChild(dockElement);
      parent = dockElement;
    }
    if (pane) {
      const paneElement = document.createElement("lumine-pane");
      // Only the real element's DOM presentation is needed; no pane item is
      // opened, terminal initialized or PTY process launched by this fixture.
      paneElement.model = {
        isFocused: () => false,
        isDestroyed: () => false,
        focus() {},
        blur() {},
      };
      paneElement.views = { getView: () => null };
      parent.appendChild(paneElement);
      parent = paneElement.itemViews;
    }
    if (nested) {
      const embedded = document.createElement("div");
      parent.appendChild(embedded);
      parent = embedded;
    }
    parent.appendChild(terminal);
    return track;
  }

  it("keeps a terminal outside pane items permanently visible", () => {
    const style = getComputedStyle(mount({ pane: false }));
    expect(style.opacity).toBe("1");
    expect(style.pointerEvents).toBe("auto");
  });

  it("keeps an embedded terminal visible even inside an unfocused dock", () => {
    const style = getComputedStyle(mount({ dock: true, nested: true }));
    expect(style.opacity).toBe("1");
    expect(style.pointerEvents).toBe("auto");
  });

  it("hides only an unfocused dock's primary terminal item", () => {
    const style = getComputedStyle(mount({ dock: true }));
    expect(style.opacity).toBe("0");
    expect(style.pointerEvents).toBe("none");
  });

  it("keeps a center terminal's primary track and separator visible", () => {
    const style = getComputedStyle(mount());
    expect(style.opacity).toBe("1");
    expect(style.boxShadow).not.toBe("none");
  });
});
