const which = require("which");

const utils = require("./utils");
const themes = require("./themes");

class Config {
  static get(keyName) {
    if (!keyName) {
      return atom.config.get(utils.PACKAGE_NAME);
    }
    let keyPath = `${utils.PACKAGE_NAME}.${keyName}`;
    return atom.config.get(keyPath);
  }
  static set(keyName, value) {
    let keyPath = `${utils.PACKAGE_NAME}.${keyName}`;
    return atom.config.set(keyPath, value);
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

function getConfigSchema() {
  let defaultTerminalCommand = getDefaultShell();

  let colorSchemaObject = {};
  for (let item of themes.THEME_COLORS) {
    let schema = {};
    schema.title = item.name;
    if (item.description) {
      schema.description = item.description;
    }
    schema.type = "color";
    schema.default = item.default;
    let key = item.short ?? item.name.toLowerCase();
    colorSchemaObject[key] = schema;
  }

  return {
    terminal: {
      title: "Terminal Settings",
      description: "Settings related to the process running the shell.",
      type: "object",
      properties: {
        shell: {
          title: "Shell",
          description: `Command to run to initialize the shell.`,
          type: "string",
          default: defaultTerminalCommand,
        },
        args: {
          title: "Arguments",
          description: "Arguments to pass to the shell initialization command (comma-separated).",
          type: "array",
          default: [],
          items: {
            type: "string",
          },
        },
        terminalType: {
          title: "Terminal Type",
          description:
            "The type of terminal to report; will be assigned to the `TERM` environment variable.",
          type: "string",
          default: "xterm-256color",
        },
        encoding: {
          title: "Character Encoding",
          description: "The encoding to use in a spawned terminal.",
          type: "string",
          default: "utf8",
        },
        env: {
          title: "Environment Variables",
          description:
            "Define, override, or delete certain environment variables within the shell.",
          type: "object",
          properties: {
            fallbackEnv: {
              title: "Fallback",
              description: `Environment variables that should always be present, even if the environment does not define them. Any existing value that may be defined in the environment will take precedence. (Accepts a stringified JSON object.)`,
              type: "string",
              default: "{}",
            },
            overrideEnv: {
              title: "Overridden",
              description: `Environment variables that should always be present _and_ take precedence over values that may already be defined in the environment. Will not supersede any variables that are defined during shell startup. (Accepts a stringified JSON object.)`,
              type: "string",
              default: "{}",
            },
            deleteEnv: {
              title: "Deleted",
              description: `Names of environment variables that should be deleted from a terminal environment whenever present on startup. (Separate multiple entries with commas.)`,
              type: "array",
              default: ["NODE_ENV"],
            },
          },
        },
      },
    },
    xterm: {
      title: "XTerm Configuration",
      description: "Customize the behavior of XTerm.js.",
      type: "object",
      properties: {
        webgl: {
          title: "WebGL Renderer",
          description: `Enable the [WebGL-based renderer](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl).`,
          type: "boolean",
          default: true,
        },
        webLinks: {
          title: "Web Links",
          description: `Enable [clickable web links](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-web-links). (Note the **Require Modifier to Open URLs** setting below.)`,
          type: "boolean",
          default: true,
        },
        ligatures: {
          title: "Ligatures",
          description: `Enable [ligature support](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-ligatures). Required if you use a coding font that combines sequences like \`==\` and \`>=\` into special glyphs. Disabling this option will result in these sequences being rendered as individual characters.`,
          type: "boolean",
          default: true,
        },
        scrollback: {
          title: "Scrollback",
          description:
            "Number of lines kept in the scrollback buffer beyond the visible rows. (Applies to new output immediately; larger values use more memory.)",
          type: "integer",
          minimum: 0,
          default: 10000,
        },
        additionalOptions: {
          title: "Additional Options",
          description: `Options to apply to XTerm terminal objects; [consult the reference](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/#properties). (Accepts a stringified JSON object.)`,
          type: "string",
          default: "{}",
        },
      },
    },
    appearance: {
      title: "Appearance",
      type: "object",
      properties: {
        fontFamily: {
          title: "Font Family",
          description:
            "Font to use in terminals. Ignored while **Use Editor Font Family** below is enabled.",
          type: "string",
          default: atom.config.get("editor.fontFamily") || "monospace",
        },
        useEditorFontFamily: {
          title: "Use Editor Font Family",
          description:
            "When enabled, terminals will always use the font family specified in the Editor settings instead of the value above.",
          type: "boolean",
          default: true,
        },
        fontSize: {
          title: "Font Size",
          description: "Font size to use in terminals.",
          type: "integer",
          default: 14,
          minimum: 8,
          maximum: 100,
        },
        useEditorFontSize: {
          title: "Use Editor Font Size",
          description:
            "When enabled, terminals will always use the font size specified in the Editor settings instead of the value above.",
          type: "boolean",
          default: true,
        },
        lineHeight: {
          title: "Line Height",
          description: "Multiplier to control space between lines.",
          type: "number",
          default: 1.3,
          minimum: 1,
          maximum: 2,
        },
        useEditorLineHeight: {
          title: "Use Editor Line Height",
          description:
            "When enabled, terminals will always use the line height specified in the Editor settings instead of the value above.",
          type: "boolean",
          default: false,
        },
        theme: {
          title: "Color Theme",
          description:
            "Which set of colors to use in the terminal. **Stylesheet** lets you (or a theme) specify terminal colors in a stylesheet; **Config** prefers the values specified in the section below; and the remaining values are legacy preset themes.\n\nIf you choose **Config**, expand the **Custom Theme Colors** heading to modify individual colors.",
          type: "string",
          enum: [
            {
              value: "Stylesheet",
              description: "Stylesheet (uses colors defined in your UI theme or user stylesheet)",
            },
            {
              value: "Config",
              description: "Config (uses colors specified below)",
            },
            "Atom Dark",
            "Atom Light",
            "Base16 Tomorrow Dark",
            "Base16 Tomorrow Light",
            "Christmas",
            "City Lights",
            "Dracula",
            "Grass",
            "Homebrew",
            "Inverse",
            "Linux",
            "Man Page",
            "Novel",
            "Ocean",
            "One Dark",
            "One Light",
            "Predawn",
            "Pro",
            "Red Sands",
            "Red",
            "Silver Aerogel",
            "Solarized Dark",
            "Solarized Light",
            "Solid Colors",
            "Standard",
          ],
          default: "Stylesheet",
        },
        customThemeColors: {
          title: "Custom Theme Colors",
          description:
            "Colors to use for a custom terminal theme. These will be ignored unless “Color Theme” above is set to `Config`.\n\n**All of these values support transparency**, even if you can’t specify it via the Settings view! Open your `config.json` to add an alpha channel to any item; specify it using `rgba` syntax (e.g., `rgba(43, 88, 145, 0.5)`).",
          type: "object",
          collapsed: true,
          properties: colorSchemaObject,
        },
      },
    },
    behavior: {
      title: "Behavior",
      description: "How Lumine manages terminal pane items within the workspace.",
      type: "object",
      properties: {
        defaultContainer: {
          title: "Default Container",
          description:
            "The destination of a terminal when one is not otherwise specified. (This can happen if you invoke **Terminal: Open** or if one is opened programmatically.)",
          type: "string",
          enum: [
            "Center",
            "Bottom Dock",
            "Left Dock",
            "Right Dock",
            "Split Up",
            "Split Down",
            "Split Left",
            "Split Right",
          ],
          default: "Bottom Dock",
        },
        activeTerminalLogic: {
          title: "Active Terminal Logic",
          description: `How the “active” terminal is determined.\n\nMany commands operate on the active terminal. If no terminal fits the selected definition, a new terminal will typically be created.`,
          type: "string",
          enum: [
            {
              value: "visible",
              description: "Most recently used visible terminal",
            },

            {
              value: "all",
              description: "Most recently used terminal, whether visible or not",
            },
          ],
          default: "visible",
        },
        prioritizedCommands: {
          title: "Prioritized Commands for Keyboard Handling",
          description:
            "A comma-separated list of Lumine commands (or command prefixes) whose keybindings should always be given priority when they overlap with terminal keybindings.\n\nAdd a command to this list if you want to guarantee that its keybinding will work properly even if the terminal has focus.\n\nYou may specify single commands (like `pane:show-previous-item`); or, to prioritize all the commands in a particular namespace, you may specify just a prefix (like `pane:`).",
          type: "array",
          default: ["terminal:", "pane:"],
        },
        runInActive: {
          title: "Run in Active Terminal",
          description: `When enabled, commands invoked via the service API will try to reuse the active terminal (if there is one) instead of opening a new terminal.`,
          type: "boolean",
          default: true,
        },
        leaveOpenAfterExit: {
          title: "Leave Open After Exit",
          description:
            "When enabled, terminal pane items will remain open even after their shells have exited. When disabled, terminal pane items will be removed from the workspace immediately upon shell exit.",
          type: "boolean",
          default: false,
        },
        showNotifications: {
          title: "Show Notifications",
          description:
            "When enabled, a notification and an in-terminal message are shown when a terminal’s shell exits or restarts. Launch errors are always shown.",
          type: "boolean",
          default: true,
        },
        relaunchTerminalsOnStartup: {
          title: "Relaunch Terminals on Startup",
          description:
            "When enabled, all terminals that were open at the end of the previous session will be restored when a project is reopened.",
          type: "boolean",
          default: true,
        },
        copyTextOnSelect: {
          title: "Copy Text on Select",
          description:
            "When enabled, terminal text will be copied to the clipboard immediately upon selection.",
          type: "boolean",
          default: false,
        },
        requireModifierToOpenUrls: {
          title: "Require Modifier to Open URLs",
          description: `When enabled, you must hold down ${utils.isMac() ? "`Cmd`" : "`Ctrl`"} while clicking on a URL in order to open it.`,
          type: "boolean",
          default: true,
        },
      },
    },
    advanced: {
      title: "Advanced",
      type: "object",
      collapsed: true,
      description: "Uncommon settings.",
      properties: {
        enableDebugLogging: {
          title: "Enable Debug Logging",
          description:
            "Logs more information from the PTY process to the developer console.\n\nYou may want to enable this if you’re reporting a bug and you’re asked to provide more information. Otherwise, leave it disabled; it’s quite verbose! (Takes effect after a terminal is restarted.)",
          type: "boolean",
          default: false,
        },
        allowedCommands: {
          title: "Allowed Commands",
          description:
            "Any sets of commands you’ve allowed to run automatically via a terminal service will appear here when you choose **Always Allow**.",
          type: "array",
          default: [],
          items: {
            type: "string",
          },
        },
        warnAboutModifierWhenOpeningUrls: {
          title: "Warn About Modifier When Opening URLs",
          description: `When enabled _and_ **Require Modifier to Open URLs** is enabled, a user’s initial click on a URL without a modifier key will show a notification explaining why no action was taken. This option is automatically switched to \`false\` after the first display of this notification.`,
          type: "boolean",
          default: true,
        },
      },
    },
    shellIntegration: {
      title: "Shell Integration",
      description:
        "Recognize OSC 133 shell-integration sequences to mark commands, decorate each prompt by exit status, and enable prompt-to-prompt navigation.\n\nRequires sourcing the matching script from the package's `shell-integration/` folder in your shell; see the package README.",
      type: "object",
      properties: {
        enabled: {
          title: "Enable Shell Integration",
          description:
            "When enabled, OSC 133 sequences emitted by your shell are used to mark commands. Has no effect until your shell is configured to emit them. (Takes effect after a terminal is restarted.)",
          type: "boolean",
          default: true,
        },
      },
    },
  };
}

async function setAutoShell() {
  if (!utils.isWindows()) return;

  // On Windows, automatically prefer PowerShell if we can locate it and the
  // user hasn't customized it before we can act.
  if (Config.get("terminal.shell") !== getDefaultShell()) {
    return;
  }

  let command = await which("pwsh.exe", { nothrow: true });
  command ??= await which("powershell.exe", { nothrow: true });
  if (!command) return;

  atom.config.set("terminal.terminal.shell", command);
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
// so the references captured by `./utils` and `./themes` during the config↔utils
// and config↔themes require cycles stay valid.
Object.assign(module.exports, { Config, getConfigSchema, possiblySetAutoShell });
