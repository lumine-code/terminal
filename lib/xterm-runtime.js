const MODULES = [
  ["Terminal", "@xterm/xterm"],
  ["FitAddon", "@xterm/addon-fit"],
  ["WebLinksAddon", "@xterm/addon-web-links"],
  ["WebglAddon", "@xterm/addon-webgl"],
  ["LigaturesAddon", "@xterm/addon-ligatures/lib/addon-ligatures.mjs"],
  ["SearchAddon", "@xterm/addon-search"],
  ["ImageAddon", "@xterm/addon-image"],
];

function createXtermRuntimeLoader(importModule = (specifier) => import(specifier)) {
  let runtimePromise;
  return function loadXtermRuntime() {
    runtimePromise ??= Promise.resolve()
      .then(() =>
        Promise.all(
          MODULES.map(async ([name, specifier]) => {
            const module = await importModule(specifier);
            // Most xterm packages expose their UMD build through Node's main
            // entry; ligatures uses its native ESM build.
            const constructor = (module.default ?? module)[name];
            if (typeof constructor !== "function")
              throw new TypeError(`${specifier} does not export ${name}.`);
            return [name, constructor];
          }),
        ),
      )
      .then((constructors) => Object.freeze(Object.fromEntries(constructors)))
      .catch((error) => {
        runtimePromise = undefined;
        throw error;
      });
    return runtimePromise;
  };
}

module.exports = {
  createXtermRuntimeLoader,
  loadXtermRuntime: createXtermRuntimeLoader(),
};
