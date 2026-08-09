# terminal

Opens a terminal, or runs commands in one.

|             |                                                       |
| ----------- | ----------------------------------------------------- |
| Version     | `1.0.0`                                               |
| Provided by | `provideTerminal()` returning `{ run, open }`         |
| Consumed by | `consumeTerminal(terminal)`                           |
| Owner       | [`terminal`](https://github.com/lumine-code/terminal) |

For a package that has a command to run and wants the user to see it happen in the editor. To open the _system's_ terminal application instead, use `terminal-spawn`.

## Registration

In your `package.json`:

```json
{
  "consumedServices": {
    "terminal": {
      "versions": { "^1.0.0": "consumeTerminal" }
    }
  }
}
```

## Contract

```ts
type Terminal = {
  run(commands: string[]): Promise<boolean>;
  open(): Promise<object>;
};
```

| Member          | Description                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `run(commands)` | Runs the commands in a terminal, opening one if needed. Resolves `false` when they were not run. |
| `open()`        | Opens a terminal and resolves to it.                                                             |

## Minimal example

```js
const { Disposable } = require("lumine");

module.exports = {
  consumeTerminal(terminal) {
    this.terminal = terminal;
    return new Disposable(() => (this.terminal = null));
  },

  async runBuild(target) {
    const ran = await this.terminal?.run([`make ${target}`]);
    if (!ran) lumine.notifications.addWarning("The build command was not run.");
  },
};
```

## Behavior

**`run` can legitimately resolve `false`, and you must handle it.** Commands are checked against the user's approval: one that is not already whitelisted raises a prompt, and if the user rejects it — or the terminal fails to become ready — nothing runs and the promise resolves `false`. Treating the call as fire-and-forget produces a package that silently does nothing.

Whether the commands go to the already-focused terminal or to a new one is the user's `behavior.runInActive` setting, not yours. Do not assume a fresh shell: the working directory and any exported state may be whatever the user left behind.

`run` waits for the terminal element to be ready before writing, so a command issued immediately after activation is not lost.

Commands are written as if typed, so quote and escape them yourself. Pass an array to run several in sequence.

## Teardown

Return a `Disposable` that drops your reference. Terminals belong to the user and to the `terminal` package — do not close ones you opened, since the user may still be reading the output.

## Versioning

`1.0.0` provided, `^1.0.0` consumed. A change that breaks this shape gets a new service name rather than a new major version, and both sides move in the same release.
