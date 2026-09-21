const which = require("which");

const utils = require("./utils");

class Config {
  static get(keyName) {
    if (!keyName) {
      return lumine.config.get(utils.PACKAGE_NAME);
    }
    let keyPath = `${utils.PACKAGE_NAME}.${keyName}`;
    return lumine.config.get(keyPath);
  }
  static set(keyName, value) {
    let keyPath = `${utils.PACKAGE_NAME}.${keyName}`;
    return lumine.config.set(keyPath, value);
  }
}

function getDefaultShell() {
  // On Windows we read `COMSPEC`, the ancient environment variable that
  // usually points to `cmd.exe`. But on first run, we will try to opt into
  // PowerShell if the system appears to have it.
  //
  // On Unix systems we'll use the venerable `SHELL` as the source of truth for
  // your login shell.
  return utils.isWindows() ? process.env.COMSPEC || "cmd.exe" : process.env.SHELL || "/bin/sh";
}

async function setAutoShell() {
  if (!utils.isWindows()) return;

  // On Windows, automatically prefer PowerShell if we can locate it and the
  // user hasn't customized it before we can act.
  const configuredShell = Config.get("terminal.shell");
  if (configuredShell && configuredShell !== getDefaultShell()) {
    return;
  }

  let command = await which("pwsh.exe", { nothrow: true });
  command ??= await which("powershell.exe", { nothrow: true });
  if (!command) return;

  lumine.config.set("terminal.terminal.shell", command);
}

async function possiblySetAutoShell() {
  if (localStorage.getItem("terminal.autoShellSet") !== null) {
    return;
  }
  // We set the flag before we even run this logic. This means we'll set it
  // even if the logic fails/errors, but that's OK; we don't want more than one
  // bite at the apple.
  localStorage.setItem("terminal.autoShellSet", "true");
  return await setAutoShell();
}

// Assign onto the existing `module.exports` object (rather than replacing it)
// so the reference captured by `./utils` during the config↔utils require cycle
// stays valid.
Object.assign(module.exports, { Config, getDefaultShell, possiblySetAutoShell });
