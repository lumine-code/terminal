const os = require("os");
const path = require("path");
const fs = require("fs-extra");
const { pathToFileURL } = require("url");

const { Terminal } = require("@xterm/xterm");
const { LocalPathLinkProvider } = require("../lib/link-detection/provider");
const pathParsing = require("../lib/link-detection/path-parsing");

// xterm.js defers flushing its write buffer via a real timer, so this only
// resolves once Jasmine's clock is real (see `jasmine.useRealClock()` below)
// — with the mocked clock, this simply never fires and the spec times out.
async function write(terminal, data) {
  return new Promise((resolve) => terminal.write(data, resolve));
}

function provideLinks(provider, bufferLineNumber) {
  return new Promise((resolve) => provider.provideLinks(bufferLineNumber, resolve));
}

describe("LocalPathLinkProvider", () => {
  let terminal, fixtureDir, filePath, dirPath, spacedFilePath;

  beforeEach(async () => {
    jasmine.useRealClock();
    terminal = new Terminal({ allowProposedApi: true, cols: 200 });

    fixtureDir = await fs.mkdtemp(
      path.join(fs.realpathSync(os.tmpdir()), "terminal-link-detection-"),
    );
    filePath = path.join(fixtureDir, "notes.txt");
    dirPath = path.join(fixtureDir, "subdir");
    spacedFilePath = path.join(fixtureDir, "a file with spaces.txt");
    await fs.writeFile(filePath, "hello");
    await fs.mkdir(dirPath);
    await fs.writeFile(spacedFilePath, "hello");
  });

  afterEach(async () => {
    terminal.dispose();
    await fs.remove(fixtureDir);
  });

  it("resolves an absolute path to an existing file", async () => {
    let provider = new LocalPathLinkProvider(
      terminal,
      () => undefined,
      () => {},
    );
    await write(terminal, filePath);
    let links = await provideLinks(provider, 1);
    expect(links.length).toBe(1);
    expect(links[0].text).toBe(filePath);
  });

  it("resolves an absolute path to an existing directory", async () => {
    let activate = jasmine.createSpy("activate");
    let provider = new LocalPathLinkProvider(terminal, () => undefined, activate);
    await write(terminal, dirPath);
    let links = await provideLinks(provider, 1);
    expect(links.length).toBe(1);
    links[0].activate({}, links[0].text);
    expect(activate).toHaveBeenCalledWith({}, dirPath, true, undefined, undefined);
  });

  it("follows a symlink when deciding that a target is a directory", async () => {
    let linkPath = path.join(fixtureDir, "linked-dir");
    await fs.symlink(dirPath, linkPath, process.platform === "win32" ? "junction" : "dir");
    let activate = jasmine.createSpy("activate");
    let provider = new LocalPathLinkProvider(terminal, () => undefined, activate);
    await write(terminal, linkPath);
    let links = await provideLinks(provider, 1);
    links[0].activate({}, links[0].text);
    expect(activate).toHaveBeenCalledWith({}, linkPath, true, undefined, undefined);
  });

  it("does not resolve a path that does not exist", async () => {
    let provider = new LocalPathLinkProvider(
      terminal,
      () => undefined,
      () => {},
    );
    await write(terminal, path.join(fixtureDir, "nope.txt"));
    let links = await provideLinks(provider, 1);
    expect(links).toBeUndefined();
  });

  it("resolves a relative path against the provided cwd", async () => {
    // A bare filename with no `/` in it (e.g. `notes.txt`) isn't detected as
    // a path candidate at all by the underlying regex — there'd be no way
    // to distinguish it from an ordinary word. A `./`-prefixed or
    // `/`-containing relative path is what gets detected.
    let provider = new LocalPathLinkProvider(
      terminal,
      () => fixtureDir,
      () => {},
    );
    await write(terminal, "edit ./notes.txt now");
    let links = await provideLinks(provider, 1);
    expect(links.length).toBe(1);
    expect(links[0].text).toBe("./notes.txt");
  });

  it("resolves a file URI and a tilde-relative path", async () => {
    let provider = new LocalPathLinkProvider(
      terminal,
      () => undefined,
      () => {},
    );
    await write(terminal, pathToFileURL(filePath).href);
    expect((await provideLinks(provider, 1)).length).toBe(1);

    terminal.reset();
    spyOn(os, "homedir").and.returnValue(fixtureDir);
    await write(terminal, "~/notes.txt");
    expect((await provideLinks(provider, 1)).length).toBe(1);
  });

  it("does not resolve a relative path when no cwd is known and the file is not in the process cwd", async () => {
    let provider = new LocalPathLinkProvider(
      terminal,
      () => undefined,
      () => {},
    );
    await write(terminal, "edit ./notes.txt now");
    let links = await provideLinks(provider, 1);
    expect(links).toBeUndefined();
  });

  it("strips a :line:col suffix and still resolves the underlying file", async () => {
    let provider = new LocalPathLinkProvider(
      terminal,
      () => undefined,
      () => {},
    );
    await write(terminal, `Error at ${filePath}:1:1 during build`);
    let links = await provideLinks(provider, 1);
    expect(links.length).toBe(1);
    expect(links[0].text).toBe(`${filePath}:1:1`);
  });

  it("passes the parsed line and column through to activate", async () => {
    let activate = jasmine.createSpy("activate");
    let provider = new LocalPathLinkProvider(terminal, () => undefined, activate);
    await write(terminal, `Error at ${filePath}:12:34 during build`);
    let links = await provideLinks(provider, 1);
    let event = {};
    links[0].activate(event, links[0].text);
    expect(activate).toHaveBeenCalledWith(event, filePath, false, 12, 34);
  });

  it("activates a resolved file link with the absolute path and isDirectory: false", async () => {
    let activate = jasmine.createSpy("activate");
    let provider = new LocalPathLinkProvider(terminal, () => undefined, activate);
    await write(terminal, filePath);
    let links = await provideLinks(provider, 1);
    let event = {};
    links[0].activate(event, links[0].text);
    expect(activate).toHaveBeenCalledWith(event, filePath, false, undefined, undefined);
  });

  it("falls back to the space-tolerant matchers for a spaced path with no other candidates", async () => {
    let provider = new LocalPathLinkProvider(
      terminal,
      () => undefined,
      () => {},
    );
    await write(terminal, spacedFilePath);
    let links = await provideLinks(provider, 1);
    expect(links.length).toBe(1);
    expect(links[0].text).toBe(spacedFilePath);
  });

  it("prefers a full spaced diagnostic path over an existing shorter prefix", async () => {
    let prefixPath = path.join(fixtureDir, "a");
    await fs.writeFile(prefixPath, "short");
    let diagnosticPath = path.join(fixtureDir, "a file with spaces.txt");
    let provider = new LocalPathLinkProvider(
      terminal,
      () => undefined,
      () => {},
    );
    await write(terminal, `${diagnosticPath}:12:3: error`);
    let links = await provideLinks(provider, 1);
    expect(links.length).toBe(1);
    expect(links[0].text).toBe(`${diagnosticPath}:12:3`);
  });

  it("resolves a spaced path:line:column suffix at end of line", async () => {
    let provider = new LocalPathLinkProvider(
      terminal,
      () => undefined,
      () => {},
    );
    await write(terminal, `${spacedFilePath}:12:3`);
    let links = await provideLinks(provider, 1);
    expect(links[0].text).toBe(`${spacedFilePath}:12:3`);
  });

  it("joins a path that wraps across buffer rows", async () => {
    terminal.dispose();
    terminal = new Terminal({ allowProposedApi: true, cols: 12 });
    let provider = new LocalPathLinkProvider(
      terminal,
      () => undefined,
      () => {},
    );
    await write(terminal, filePath);
    let links = await provideLinks(provider, 1);
    expect(links.length).toBe(1);
    expect(links[0].text).toBe(filePath);
  });

  it("maps a link range after a wide character", async () => {
    let provider = new LocalPathLinkProvider(
      terminal,
      () => undefined,
      () => {},
    );
    await write(terminal, `界 ${filePath}`);
    let links = await provideLinks(provider, 1);
    expect(links[0].range.start.x).toBe(4);
  });

  it("caps filesystem validation work on a path-heavy line", async () => {
    let stat = spyOn(fs, "stat").and.callThrough();
    let provider = new LocalPathLinkProvider(
      terminal,
      () => fixtureDir,
      () => {},
    );
    let candidates = Array.from({ length: 100 }, (_, index) => `./missing-${index}/file`).join(" ");
    await write(terminal, candidates);
    await provideLinks(provider, 1);
    expect(stat.calls.count()).toBeLessThanOrEqual(50);
  });

  it("returns no links when parsing fails unexpectedly", async () => {
    spyOn(pathParsing, "detectLinks").and.throwError("parse failed");
    let provider = new LocalPathLinkProvider(
      terminal,
      () => fixtureDir,
      () => {},
    );
    await write(terminal, `Error at ${filePath} during build`);
    expect(await provideLinks(provider, 1)).toBeUndefined();
  });

  it("returns undefined for a line with no path-like content", async () => {
    let provider = new LocalPathLinkProvider(
      terminal,
      () => undefined,
      () => {},
    );
    await write(terminal, "just some plain output");
    let links = await provideLinks(provider, 1);
    expect(links).toBeUndefined();
  });
});
