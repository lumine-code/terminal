const { createXtermRuntimeLoader } = require("../lib/xterm-runtime");

describe("Terminal native xterm runtime loader", () => {
  const constructors = {
    Terminal: class Terminal {},
    FitAddon: class FitAddon {},
    WebLinksAddon: class WebLinksAddon {},
    WebglAddon: class WebglAddon {},
    LigaturesAddon: class LigaturesAddon {},
    SearchAddon: class SearchAddon {},
    ImageAddon: class ImageAddon {},
  };

  function moduleFor(specifier) {
    return specifier.endsWith(".mjs") ? constructors : { default: constructors };
  }

  it("shares pending imports and resolved constructors across terminal callers", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const importer = jasmine.createSpy("native importer").and.callFake(async (specifier) => {
      await gate;
      return moduleFor(specifier);
    });
    const load = createXtermRuntimeLoader(importer);
    const first = load();
    expect(load()).toBe(first);
    release();
    expect(await first).toEqual(constructors);
    expect(await load()).toBe(await first);
    expect(importer.calls.count()).toBe(7);
  });

  it("retries a rejected module load instead of retaining the failed promise", async () => {
    const failure = new Error("Runtime import failed");
    let fail = true;
    const load = createXtermRuntimeLoader(async (specifier) => {
      if (fail) throw failure;
      return moduleFor(specifier);
    });
    await expectAsync(load()).toBeRejectedWith(failure);
    fail = false;
    expect(await load()).toEqual(constructors);
  });
});
