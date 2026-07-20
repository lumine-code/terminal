## 1.0.0

* Rebranded as a Lumine package under the `lumine-code` organization.
* Renamed the custom terminal element from `pulsar-terminal` to `terminal-view`.
  Keymaps and stylesheets that target the old element name must be updated.
* Updated package metadata, documentation links, and license attribution.
* Switched from the `@pulsar-edit/node-pty` fork to upstream `node-pty` (`^1.1.0`),
  which now publishes stable releases with the same `node-addon-api` binding.

## 0.1.0

* Initial implementation; most tasks seem to work. Resizing is a bit wonky.
* No support for profiles yet (might take them out!).
* No wiring up of services.
* Not all settings will update in real time when changed.
* No specs yet.
