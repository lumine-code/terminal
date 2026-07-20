## 1.0.0

* Rebranded as a Lumine package under the `lumine-code` organization.
* Renamed the custom terminal element from `pulsar-terminal` to `terminal-view`.
  Keymaps and stylesheets that target the old element name must be updated.
* Updated package metadata, documentation links, and license attribution.
* Switched from the `@pulsar-edit/node-pty` fork to upstream `node-pty` (`^1.1.0`),
  which now publishes stable releases with the same `node-addon-api` binding.
* Rewrote the package in plain CommonJS JavaScript. The TypeScript sources and the
  Rollup build step are gone; the package now loads directly from `lib/`.
* Dropped the `typescript`, `rollup`, `tslib`, and `@pulsar-edit/types` (`@types/atom`)
  toolchain dependencies. The `@xterm/addon-ligatures` ESM addon now loads through
  Node's `require(esm)` support instead of being bundled.
* Converted the keymap to JSON and the stylesheets to CSS with custom properties.
* Flattened `lib/`: the pty worker moved from `lib/worker/pty.js` to `lib/pty-worker.js`.
* Removed the legacy `platformioIDETerminal` service. The `terminal` service (`2.0.0`)
  is now the sole provided service.

## 0.1.0

* Initial implementation; most tasks seem to work. Resizing is a bit wonky.
* No support for profiles yet (might take them out!).
* No wiring up of services.
* Not all settings will update in real time when changed.
* No specs yet.
