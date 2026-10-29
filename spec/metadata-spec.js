const { TerminalModel } = require("../lib/model");

describe("Terminal metadata", () => {
  let model;

  beforeEach(async () => {
    model = new TerminalModel({ uri: "terminal://metadata-test", terminals: new Set() });
    await model.ready();
  });

  afterEach(() => model.destroy());

  it("describes the live working directory without treating it as a file", () => {
    const directory = require("node:os").tmpdir();
    model.setCwd(directory);
    const rows = model.getMetadata()[0].rows;
    expect(rows.find((row) => row.id === "cwd").value).toBe(directory);
    expect(model.getPath).toBeUndefined();
    expect(model.element).toBeUndefined();
  });

  it("invalidates directory changes and releases observation on disposal", () => {
    const changed = jasmine.createSpy("metadata changed");
    const subscription = model.onDidChangeMetadata(changed);
    model.setCwd(require("node:os").tmpdir());
    expect(changed).toHaveBeenCalled();
    subscription.dispose();
    changed.calls.reset();
    model.setCwd(undefined);
    expect(changed).not.toHaveBeenCalled();
  });

  it("honors cancellation and exposes no retired metadata", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => model.getMetadata({ signal: controller.signal })).toThrow();
    const closed = jasmine.createSpy("closed");
    model.onDidDestroy(closed);
    model.destroy();
    model.destroy();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(model.getMetadata()).toEqual([]);
    expect(model.setCwd(require("node:os").tmpdir())).toBe(false);
  });
});
