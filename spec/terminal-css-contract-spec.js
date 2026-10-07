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
