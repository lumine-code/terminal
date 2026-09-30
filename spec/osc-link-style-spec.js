const { Terminal } = require("@xterm/xterm");
const { suppressOscLinkUnderline } = require("../lib/link-detection/osc-link-style");

const URI = "https://example.com/a;b";
const START = `\x1b]8;id=shared;${URI}\x07`;
const END = "\x1b]8;;\x07";

function write(terminal, text) {
  return new Promise((resolve) => terminal.write(text, resolve));
}

describe("OSC 8 link styles", () => {
  let terminal, adapter;

  beforeEach(() => {
    jasmine.useRealClock();
    terminal = new Terminal({ allowProposedApi: true, cols: 80, rows: 5 });
    adapter = suppressOscLinkUnderline(terminal);
  });

  afterEach(() => {
    adapter.dispose();
    terminal.dispose();
  });

  function cell(column, row = 0) {
    return terminal.buffer.active.getLine(row).getCell(column);
  }

  it("checks the installed xterm attribute boundary explicitly", () => {
    expect(require("@xterm/xterm/package.json").version).toBe("6.0.0");
    expect(() => suppressOscLinkUnderline({})).toThrowError(
      "Terminal: Unsupported xterm OSC 8 attribute API.",
    );
    expect(() =>
      suppressOscLinkUnderline({ _core: { _inputHandler: { getAttrData: () => ({}) } } }),
    ).toThrowError("Terminal: Unsupported xterm OSC 8 attribute API.");
  });

  it("keeps OSC 8 metadata without underlining its ordinary text", async () => {
    await write(terminal, `${START}link${END}plain`);

    expect(cell(0).isUnderline()).toBe(0);
    expect(cell(0).extended.underlineStyle).toBe(0);
    expect(cell(0).extended.urlId).toBeGreaterThan(0);
    const links = terminal._core._linkProviderService.linkProviders;
    let supplied;
    links[0].provideLinks(1, (reply) => (supplied = reply));
    expect(supplied.length).toBe(1);
    expect(supplied[0].text).toBe(URI);
    expect(supplied[0].range).toEqual({ start: { x: 1, y: 1 }, end: { x: 4, y: 1 } });
    expect(terminal._core._oscLinkService.getLinkData(cell(0).extended.urlId)).toEqual({
      id: "shared",
      uri: URI,
    });
    expect(cell(4).extended.urlId).toBe(0);
    expect(cell(4).isUnderline()).toBe(0);
  });

  it("preserves genuine ANSI underline styles inside and outside links", async () => {
    await write(
      terminal,
      `\x1b[4mS${START}S\x1b[4:2mD\x1b[4:3mC\x1b[4:4mO\x1b[4:5mA\x1b[24mN${END}\x1b[4mS`,
    );

    for (const [column, style] of [
      [0, 1],
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4],
      [5, 5],
      [6, 0],
      [7, 1],
    ]) {
      expect(Boolean(cell(column).isUnderline())).toBe(style !== 0);
      expect(cell(column).extended.underlineStyle).toBe(style);
      expect(cell(column).extended.urlId > 0).toBe(column >= 1 && column <= 6);
    }
  });

  it("preserves underline color, foreground and background across attribute clones", async () => {
    await write(terminal, `\x1b[31;44;4:3;58;2;12;34;56m${START}A\x1b[59mB${END}C`);

    expect(cell(0).getUnderlineStyle()).toBe(3);
    expect(cell(0).getUnderlineColor()).toBe((12 << 16) | (34 << 8) | 56);
    expect(cell(0).isUnderlineColorRGB()).toBe(true);
    for (const column of [0, 1, 2]) {
      expect(cell(column).getFgColor()).toBe(1);
      expect(cell(column).getBgColor()).toBe(4);
      expect(cell(column).getUnderlineStyle()).toBe(3);
    }
    expect(cell(1).getUnderlineColor()).toBe(cell(2).getUnderlineColor());
    expect(cell(1).getUnderlineColorMode()).toBe(cell(2).getUnderlineColorMode());
    expect(cell(2).extended.urlId).toBe(0);
  });

  it("resets ANSI underline on SGR 0 while retaining the open hyperlink", async () => {
    await write(terminal, `${START}\x1b[4:3mC\x1b[0mN${END}`);

    expect(cell(0).getUnderlineStyle()).toBe(3);
    expect(cell(1).isUnderline()).toBe(0);
    expect(cell(1).extended.underlineStyle).toBe(0);
    expect(cell(1).extended.urlId).toBe(cell(0).extended.urlId);
  });

  it("packs only the genuine ANSI style for the WebGL renderer", async () => {
    await write(terminal, `${START}N\x1b[4:3;58;2;12;34;56mC${END}`);
    // CellColorResolver feeds extended.ext into TextureAtlas's own attributes.
    // Reconstruct them exactly as that renderer does, with no URL metadata.
    const Base = new Terminal({ allowProposedApi: true });
    try {
      const rendered = Base._core._inputHandler.getAttrData().clone();
      rendered.fg = cell(0).fg;
      rendered.bg = cell(0).bg;
      rendered.extended.ext = cell(0).extended.ext;
      expect(rendered.isUnderline()).toBe(0);
      rendered.fg = cell(1).fg;
      rendered.bg = cell(1).bg;
      rendered.extended.ext = cell(1).extended.ext;
      expect(rendered.isUnderline()).toBeTruthy();
      expect(rendered.getUnderlineStyle()).toBe(3);
      expect(rendered.getUnderlineColor()).toBe((12 << 16) | (34 << 8) | 56);
    } finally {
      Base.dispose();
    }
  });

  for (const reset of ["public", "RIS", "soft"]) {
    it(`keeps adapting links after ${reset} reset`, async () => {
      await write(terminal, `${START}old${END}`);
      if (reset === "public") terminal.reset();
      else await write(terminal, reset === "RIS" ? "\x1bc" : "\x1b[!p\r");
      await write(terminal, `${START}new${END}`);

      expect(cell(0).getChars()).toBe("n");
      expect(cell(0).isUnderline()).toBe(0);
      expect(cell(0).extended.urlId).toBeGreaterThan(0);
    });
  }

  it("retains xterm's default handling of malformed OSC 8 and sequential links", async () => {
    await write(
      terminal,
      `\x1b]8;malformed\x07P${START}A\x1b]8;;https://example.com/other\x07B${END}P`,
    );

    expect(cell(0).extended.urlId).toBe(0);
    expect(cell(1).extended.urlId).toBeGreaterThan(0);
    expect(cell(2).extended.urlId).toBeGreaterThan(0);
    expect(cell(2).extended.urlId).not.toBe(cell(1).extended.urlId);
    expect(cell(3).extended.urlId).toBe(0);
    for (const column of [0, 1, 2, 3]) expect(cell(column).isUnderline()).toBe(0);
  });

  it("leaves the intrinsic OSC 8 style of another terminal unchanged", async () => {
    const other = new Terminal({ allowProposedApi: true });
    try {
      await write(terminal, `${START}A${END}`);
      await write(other, `${START}B${END}`);

      expect(cell(0).isUnderline()).toBe(0);
      const otherCell = other.buffer.active.getLine(0).getCell(0);
      expect(otherCell.isUnderline()).toBeTruthy();
      expect(otherCell.extended.underlineStyle).toBe(5);
    } finally {
      other.dispose();
    }
  });

  it("removes the parser hook and restores current attributes on dispose", async () => {
    await write(terminal, `${START}A`);
    const id = cell(0).extended.urlId;
    adapter.dispose();
    adapter.dispose();
    await write(terminal, `B${END}${START}C${END}`);

    expect(cell(0).isUnderline()).toBe(0);
    expect(cell(1).extended.urlId).toBe(id);
    expect(cell(1).isUnderline()).toBeTruthy();
    expect(cell(2).extended.underlineStyle).toBe(5);
  });
});
