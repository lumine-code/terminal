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
  // Resolve an empty shell setting at launch without persisting a detected
  // executable into the user's configuration.
  return utils.isWindows() ? process.env.COMSPEC || "cmd.exe" : process.env.SHELL || "/bin/sh";
}

// Assign onto the existing `module.exports` object (rather than replacing it)
// so the reference captured by `./utils` during the config↔utils require cycle
// stays valid.
Object.assign(module.exports, { Config, getDefaultShell });
