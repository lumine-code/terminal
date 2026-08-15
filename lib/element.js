const fs = require("fs-extra");

const { CompositeDisposable, Disposable } = require("lumine");
const { isSafeSignal } = require("./model");
const { Config } = require("./config");
const Logger = require("./log");

const { Terminal: XTerminal } = require("@xterm/xterm");
const { FitAddon } = require("@xterm/addon-fit");
const { WebLinksAddon } = require("@xterm/addon-web-links");
const { WebglAddon } = require("@xterm/addon-webgl");
const { LigaturesAddon } = require("@xterm/addon-ligatures/lib/addon-ligatures.mjs");
const { SearchAddon } = require("@xterm/addon-search");
const { ImageAddon } = require("@xterm/addon-image");

const FindPalette = require("./find-palette");
const ShellIntegration = require("./shell-integration");

const { Pty } = require("./pty");

const {
  isMac,
  isWindows,
  PACKAGE_NAME,
  parseEnvConfigValue,
  timeout,
  willUseConPTY,
  windowsBuildNumber,
} = require("./utils");
const { getTheme } = require("./themes");

// Given a line height and a font size, attempts to adjust the line height so
// that it results in a pixel height that snaps to the nearest pixel (or
// sub-pixel, taking device pixel ratio into account).
//
// In theory, this would be needed for synchronization with Lumine, since the
// editor code does something similar. In practice, though, line height values
// seem to be applied differently in XTerm; a shared line-height value between
// the editor and the terminal window results in much taller lines in the
// terminal.
function clampLineHeight(lineHeight, fontSize) {
  let lineHeightInPx = fontSize * lineHeight;
  let roundedScaledLineHeightInPx = Math.round(lineHeightInPx * window.devicePixelRatio);
  return roundedScaledLineHeightInPx / (fontSize * window.devicePixelRatio);
}

// Lumine's editor scrollbars are native (webkit) scrollbars whose width the
// active UI theme decides (10px for the bundled themes, 14px for the VS Code
// theme) and which collapse to a fading overlay where the platform uses overlay
// scrollbars. XTerm paints its own scrollbar and can't pick that width up from
// CSS, so we measure the real editor scrollbar width with a throwaway probe and
// hand it to XTerm's `overviewRuler.width` option, which governs the scrollbar
// width. The probe is appended inside `lumine-workspace` so it inherits the same
// `.scrollbars-visible-always` cascade the editor sees; a reserved width of 0
// (overlay scrollbars, e.g. macOS) falls back to a sensible default.
const FALLBACK_SCROLLBAR_WIDTH = 10;

function measureEditorScrollbarWidth(preferredHost) {
  let host = preferredHost?.isConnected ? preferredHost : lumine.workspace.getElement();
  let probe = document.createElement("div");
  probe.style.cssText =
    "position: absolute; top: -9999px; width: 100px; height: 100px; overflow: scroll;";
  host.appendChild(probe);
  let width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return width > 0 ? width : FALLBACK_SCROLLBAR_WIDTH;
}

// Takes a DOM `KeyboardEvent` whose default was already prevented and creates
// a fresh event so we can re-propagate it upward. This allows certain key
// bindings and key sequences to keep working even if some of their events are
// swallowed by xterm.js.
function redispatchKeyboardEvent(originalEvent, targetElement) {
  let newEvent = new KeyboardEvent(originalEvent.type, {
    bubbles: true,
    cancelable: true,
    key: originalEvent.key,
    code: originalEvent.code,
    location: originalEvent.location,
    ctrlKey: originalEvent.ctrlKey,
    shiftKey: originalEvent.shiftKey,
    altKey: originalEvent.altKey,
    metaKey: originalEvent.metaKey,
    repeat: originalEvent.repeat,
    isComposing: originalEvent.isComposing,
  });

  targetElement.dispatchEvent(newEvent);
}

// `FitAddon#proposeDimensions` clamps its proposal to at least 2×1 — but the
// clamp is `Math.max`, which passes NaN through. A pane that is hidden or
// mid-collapse measures `auto`, `parseInt` turns that into NaN, and the
// proposal arrives as `{ cols: NaN, rows: NaN }`. Nothing downstream survives
// that: xterm quietly ignores it, but node-pty throws — and it throws inside
// the shared worker process, whose uncaught-exception handler exits, taking
// every terminal in the window with it. Every consumer checks the proposal
// with this before acting on it.
function isUsableGeometry(geometry) {
  return (
    Number.isInteger(geometry.cols) &&
    Number.isInteger(geometry.rows) &&
    geometry.cols > 0 &&
    geometry.rows > 0
  );
}

// ConPTY repaints the entire screen after every PTY resize: erase sequences
// first, the redrawn content afterwards, and a full-screen application
// redraws itself the moment it learns the new size — codex, for one, resets
// the scroll region, erases the screen AND the scrollback (CSI 3 J, sent
// outside its own synchronized-update block), then reprints its entire
// transcript in bursts spread over hundreds of milliseconds. Rendered
// verbatim, that stream produces two artifacts: gaps between bursts paint
// erased intermediate states, and the scrollback wipe makes the scrollbar
// thumb balloon to the full pane height and visibly crawl back down as the
// transcript re-parses (xterm's viewport syncs the thumb from parse-time
// buffer events, so no render freeze can hide it).
//
// The settle window that follows every PTY resize covers both. Output is
// written in bursts, each wrapped in DEC private mode 2026 (synchronized
// output) so xterm paints it in a single frame even when the parser yields
// mid-burst; and the scrollbar thumb is visually frozen (styles/terminal.css
// pins it while `terminal--resize-settling` is set) until the stream has
// been quiet long enough to call the redraw finished, at which point it hops
// straight to its final geometry. The 2026 markers travel inside the data
// stream, so they can never catch the renderer's own canvas resize or
// outlive their burst; xterm force-releases a stuck freeze after 1s anyway.
const RESIZE_SETTLE_QUIET_MS = 35; // close a burst: paint it atomically
const RESIZE_SETTLE_BATCH_MAX_MS = 150; // a burst may not delay paint longer
const RESIZE_SETTLE_END_MS = 250; // stream quiet this long: redraw is over
const RESIZE_SETTLE_MAX_MS = 1000; // whatever happens, the window ends here
const SYNC_UPDATE_START = "\x1b[?2026h";
const SYNC_UPDATE_END = "\x1b[?2026l";

class TerminalElement extends HTMLElement {
  model;
  terminal;
  pty;
  initialized = false;
  uid = undefined;

  subscriptions = new CompositeDisposable();
  initializedPromise;
  createdPromise;
  findPalette;

  // Object that holds the various elements.
  div;

  #mainResizeObserver;
  #mainContentRect;
  #terminalIntersectionObserver;
  #terminalInitiallyVisible = false;
  #fitAddon;
  #searchAddon;
  #ligaturesAddon;
  #imageAddon;
  #shellIntegration;
  #prioritizedPrefixes = [];

  #liveFitScheduled = false;
  // Non-null while a column rewrap has been applied recently; further width
  // changes defer until the size has been stable. See `#liveFit`.
  #colsSettleTimer = null;

  // The settle window that follows a PTY resize; while it is open, output is
  // batched into atomic bursts and the scrollbar thumb is frozen. See the
  // RESIZE_SETTLE_* constants for the shape.
  #settleActive = false;
  #settleDeadline = 0;
  #settleChunks = null;
  #settleBatchStart = 0;
  #settleFlushTimer;
  #settleEndTimer;

  // A worker process started ahead of time by `#createTerminal`, waiting to be
  // told which shell to run. Cleared as soon as `restartPtyProcess` adopts it.
  #bootingPty;

  // Metadata about the PTY.
  #ptyMeta = {};

  // Whether the current session has already reported that its worker process
  // died. A worker that dies mid-launch reaches both the `onError` handler and
  // the `catch` around the launch, and the user needs to be told once.
  #hostErrorReported = false;

  static create() {
    return document.createElement("terminal-view");
  }

  async initialize(model) {
    this.model = model;
    this.model.setElement(this);

    this.div = {
      top: document.createElement("div"),
      main: document.createElement("div"),
      terminal: document.createElement("div"),
      palette: document.createElement("div"),
    };

    this.div.top.classList.add("terminal__top");
    this.div.main.classList.add("terminal__main");
    this.div.palette.classList.add("terminal__palette");
    this.div.terminal.classList.add("terminal__terminal");
    this.div.main.appendChild(this.div.terminal);

    this.appendChild(this.div.top);
    this.appendChild(this.div.palette);
    this.appendChild(this.div.main);

    let initializeResolve;
    let initializeReject;
    this.initializedPromise = new Promise((resolve, reject) => {
      initializeResolve = resolve;
      initializeReject = reject;
    });

    try {
      await this.model.ready();
      this.setAttribute("session-id", this.model.getSessionId());

      // Track the pane divider frame by frame. The terminal refits live —
      // otherwise its canvas keeps the old geometry for the whole drag,
      // clipping away the bottom rows (the prompt) as the pane shrinks and
      // snapping everything back on the eventual refit, which reads as the
      // text blinking out and in on every reflow. Rows always track the drag;
      // a column change is a rewrap and settles like the editor's soft wrap
      // (see `#liveFit`). The PTY is told about the new size only once the
      // size has been stable: a full-screen application repaints on every
      // resize it hears about, and it only needs the final one.
      let ptyResizeTimer;
      let debouncedResizePty = () => {
        clearTimeout(ptyResizeTimer);
        ptyResizeTimer = setTimeout(
          () => this.resizePtyToTerminal(),
          Math.max(this.#resizeSettleInterval(), 100),
        );
      };

      this.#mainResizeObserver = new ResizeObserver((entries) => {
        let last = entries[entries.length - 1];
        this.#mainContentRect = last.contentRect;
        this.#scheduleLiveFit();
        debouncedResizePty();
      });
      this.#mainResizeObserver.observe(this.div.main);
      this.subscriptions.add(new Disposable(() => clearTimeout(ptyResizeTimer)));

      this.#terminalIntersectionObserver = new IntersectionObserver(
        async (entries) => {
          let last = entries[entries.length - 1];

          if (last.intersectionRatio !== 1.0) return;
          this.#terminalInitiallyVisible = true;
          try {
            await this.createTerminal();
            initializeResolve();
          } catch (error) {
            initializeReject(error);
          }

          this.#terminalIntersectionObserver?.disconnect();
          this.#terminalIntersectionObserver = null;
        },
        {
          root: this,
          threshold: 1.0,
        },
      );
      this.#terminalIntersectionObserver.observe(this.div.terminal);
      this.subscriptions.add(
        new Disposable(() => this.#terminalIntersectionObserver?.disconnect()),
      );

      this.subscriptions.add(
        // Immediately apply new `fontSize` values when appropriate.
        lumine.config.onDidChange("editor.fontSize", ({ newValue }) => {
          if (!Config.get("appearance.useEditorFontSize")) return;
          if (!this.terminal) return;
          this.terminal.options.fontSize = newValue;
          this.refitTerminal();
        }),
        lumine.config.onDidChange("terminal.appearance.fontSize", ({ newValue }) => {
          if (Config.get("appearance.useEditorFontSize")) return;
          if (!this.terminal) return;
          this.terminal.options.fontSize = newValue;
          this.refitTerminal();
        }),
        lumine.config.onDidChange("terminal.xterm.scrollback", ({ newValue }) => {
          if (!this.terminal) return;
          this.terminal.options.scrollback = newValue;
        }),
        // Setting the limit lower than the images already held evicts down to
        // it synchronously, so this needs no separate flush.
        lumine.config.onDidChange("terminal.xterm.imageStorageLimit", ({ newValue }) => {
          if (this.#imageAddon) this.#imageAddon.storageLimit = newValue;
        }),
        lumine.config.observe("terminal.behavior.prioritizedCommands", (newValue) => {
          this.#prioritizedPrefixes = newValue;
        }),
      );
    } catch (error) {
      initializeReject(error);
      throw error;
    }
    this.initialized = true;
  }

  // Awaits initialization of the terminal. Resolves when a terminal is ready
  // to accept text.
  async ready() {
    return await this.initializedPromise;
  }

  getModel() {
    return this.model;
  }

  destroy() {
    clearTimeout(this.#settleFlushTimer);
    clearTimeout(this.#settleEndTimer);
    clearTimeout(this.#colsSettleTimer);
    this.#colsSettleTimer = null;
    this.#settleActive = false;
    this.#settleChunks = null;
    this.pty?.kill();
    // An element torn down between `#createTerminal` and `restartPtyProcess`
    // still has a worker booting for it, and nothing else will ever claim it.
    this.#bootingPty?.kill();
    this.#bootingPty = undefined;
    this.#shellIntegration?.dispose();
    // xterm disposes its renderer before addons. The ligatures addon's
    // teardown deregisters a character joiner and requests a refresh, which
    // then runs against that missing renderer. Remove it while xterm is still
    // fully alive; its wrapped dispose also unregisters it from AddonManager.
    this.#ligaturesAddon?.dispose();
    this.#ligaturesAddon = undefined;
    // Same reasoning: the image addon holds decoded bitmaps and a renderer
    // hook, so release them while xterm is still whole.
    this.#imageAddon?.dispose();
    this.#imageAddon = undefined;
    this.terminal?.dispose();
    this.subscriptions.dispose();
  }

  scrollToPreviousCommand() {
    this.#shellIntegration?.scrollToPreviousCommand();
  }

  scrollToNextCommand() {
    this.#shellIntegration?.scrollToNextCommand();
  }

  getShellCommand() {
    return Config.get("terminal.shell");
  }

  getArgs() {
    let args = Config.get("terminal.args");
    if (!Array.isArray(args)) {
      throw new Error("Arguments must be an array");
    }
    return args;
  }

  getTerminalType() {
    return Config.get("terminal.terminalType");
  }

  // Whether this terminal wants a worker process of its own rather than the
  // one every other terminal shares. Read when the session is created, so
  // changing the setting only affects terminals opened afterwards.
  getPtyHostOptions() {
    return { dedicated: !Config.get("advanced.shareProcess") };
  }

  #shouldPrioritizeBinding(kb, ancestorChain) {
    let matchesPrioritizedPrefix = this.#prioritizedPrefixes.some((prefix) => {
      if (prefix.endsWith(":")) return kb.command.startsWith(prefix);
      else return kb.command === prefix;
    });
    if (!matchesPrioritizedPrefix) return false;
    if (ancestorChain) {
      Logger.debug(
        "Considering binding",
        kb,
        "in the context of event target",
        ancestorChain[0],
        "and full ancestor chain:",
        ancestorChain,
      );

      // Weed out bindings that cannot apply within this DOM context. If this is
      // a valid binding for this context, our target (or one of its ancestors)
      // will match the given selector.
      //
      // Eventually, we won't need to do this manually, and will instead be able
      // to ask `lumine.keymaps` for this information.
      if (!ancestorChain.some((node) => node?.matches(kb.selector))) return false;

      Logger.log(
        "Prioritizing binding for command",
        kb.command,
        "because our DOM context matches the selector",
        kb.selector,
      );
    } else {
      // We don't have the DOM context to help us make this decision, so we'll
      // let this through on the strength of the command prefix matching.
      Logger.log(
        "Prioritizing binding for command",
        kb.command,
        "because it matches our whitelist of command prefixes",
      );
      return true;
    }
    return true;
  }

  // Returns `true` if, at the current moment, Lumine’s `KeymapManager` has at
  // least one pending keybinding that belongs to one of this package's commands.
  //
  // We use this to decide whether we should re-propagate a keyboard event that
  // xterm.js already swallowed. If we don't do this, `KeymapManager` gets
  // confused, especially since it'll still receive the `keyup` event for the key
  // the user just pressed.
  #keymapHasPendingPartialMatches() {
    // Undocumented
    let partialMatches = lumine.keymaps.pendingPartialMatches;
    if (!partialMatches) return false;
    return partialMatches.some((kb) => this.#shouldPrioritizeBinding(kb));
  }

  // Returns `true` if the given keyboard event matches at least one key binding
  // for this package.
  //
  // This is a heuristic that allows for certain exceptions to xterm.js's
  // aggressive management of keyboard events. Lots of keybindings have some sort
  // of obscure effect in a PTY, and that vastly constrains the set of bindings
  // that can reliably be used to bind to Lumine commands when the terminal has
  // focus. The way out of that is to register a custom keyboard handler so that
  // we get first dibs on handling any keyboard event.
  //
  // But that also means we've got to do the work to decide if a given keyboard
  // event _would_ trigger a Lumine keybinding… without actually triggering the
  // key binding!
  //
  // Ideally, more of this work will one day be performed by the `KeymapManager`
  // instance at `lumine.keymaps` — which would more easily let us give Lumine
  // keybindings _in general_ precedence over terminal bindings. But this is
  // enough to get us past the issue of this package not even being able to
  // trigger _some of its own commands_ when the terminal has focus.
  #keyboardEventMatchesKeybinding(event) {
    let keystroke = lumine.keymaps.keystrokeForKeyboardEvent(event);

    // The approach below finds candidates in isolation. This works well for
    // keybindings, but will not work for key sequences, since we're not
    // incorporating the `KeymapManager` state in this search. That's why the
    // approach in the function above still comes in handy.
    // Undocumented.
    let bindings = lumine.keymaps.findMatchCandidates([keystroke], []);
    Logger.debug("Looked for bindings that match", keystroke, "and found candidates:", bindings);

    if (bindings.exactMatchCandidates.length === 0) return false;

    // The matching bindings have not yet been checked to see if they apply in
    // this DOM context. So we'll build a list of elements starting with the
    // target element, then moving upward in the tree and adding each of its
    // element ancestors. We do this here in order to prevent duplicated work.
    let target = event.target;
    if (!target) return false;

    let ancestorChain = [];
    let node = target;
    while (node && node.matches) {
      ancestorChain.push(node);
      if (node.parentNode === document) break;
      node = node.parentNode;
    }

    let result = bindings.exactMatchCandidates.some((kb) =>
      this.#shouldPrioritizeBinding(kb, ancestorChain),
    );

    if (result) {
      Logger.log(
        "Assuming control of keybinding:",
        keystroke,
        "because it matches at least one Lumine binding",
      );
    }
    return result;
  }

  // Ensures the given path exists and points to a valid directory on disk.
  async pathIsDirectory(filePath) {
    if (!filePath) return false;
    try {
      const stats = await fs.stat(filePath);
      if (stats?.isDirectory()) return true;
    } catch {
      return false;
    }
    return false;
  }

  // Determines the proper `cwd` for this shell.
  async getCwd() {
    if (!this.model) return;
    let cwd = this.model.cwd;

    if (await this.pathIsDirectory(cwd)) {
      return cwd;
    }

    cwd = lumine.project.getPaths()[0];
    if (await this.pathIsDirectory(cwd)) {
      return cwd;
    }

    // If we get this far, the `cwd` on the model is invalid!
    if (this.model) {
      this.model.cwd = undefined;
    }

    return undefined;
  }

  getEnv() {
    // Advertise 24-bit color support: xterm.js renders truecolor SGR
    // sequences. Seeded before the other layers so the inherited environment
    // and the user's env settings can still override or delete it.
    let env = { COLORTERM: "truecolor" };

    let fallbackEnvRaw = Config.get("terminal.env.fallbackEnv") ?? "{}";
    let overrideEnvRaw = Config.get("terminal.env.overrideEnv") ?? "{}";
    let deleteEnv = Config.get("terminal.env.deleteEnv") ?? [];

    let fallbackEnv = parseEnvConfigValue(fallbackEnvRaw);
    let overrideEnv = parseEnvConfigValue(overrideEnvRaw);

    // First copy over the fallbacks…
    Object.assign(env, fallbackEnv);
    // …then whatever we inherited from `process.env`…
    Object.assign(env, { ...process.env });
    // An empty inherited COLORTERM value carries no capability information and
    // must not suppress the terminal's truecolor advertisement.
    if (!env.COLORTERM) env.COLORTERM = "truecolor";
    // …then whatever we're overriding.
    Object.assign(env, overrideEnv);

    // Then delete any that shouldn't be there.
    for (let key of deleteEnv) {
      delete env[key];
    }
    return env;
  }

  getEncoding() {
    return Config.get("terminal.encoding") ?? "utf8";
  }

  leaveOpenAfterExit() {
    return Config.get("behavior.leaveOpenAfterExit");
  }

  isPtyProcessRunning() {
    return this.pty && this.#ptyMeta?.running;
  }

  getExtraXTermOptions() {
    let rawValue = Config.get("xterm.additionalOptions");
    let result = {};
    if (rawValue) {
      try {
        result = JSON.parse(rawValue);
      } catch {
        lumine.notifications.addError("Terminal: Invalid configuration", {
          description: `The value of **XTerm Configuration → Additional Options** is not valid JSON.`,
        });
        result = {};
      }
    }
    return result;
  }

  // XTerm derives its scrollbar width from `overviewRuler.width`, so we size the
  // ruler to match Lumine's editor scrollbar (measured from the active theme).
  // No borders: they would draw marks at the top and bottom of the track. The
  // ruler still hosts the search-result markers.
  getOverviewRulerOptions() {
    return {
      showTopBorder: false,
      showBottomBorder: false,
      width: measureEditorScrollbarWidth(this),
    };
  }

  getXtermOptions() {
    let xtermOptions = {
      cursorBlink: false,
      // Full-screen terminal applications can paint cell backgrounds that
      // contrast poorly with a light theme's dark foreground. Let xterm
      // adjust those glyphs per cell to the WCAG AA contrast threshold.
      minimumContrastRatio: 4.5,
      scrollback: Config.get("xterm.scrollback"),
      overviewRuler: this.getOverviewRulerOptions(),
      ...this.getExtraXTermOptions(),
    };
    let fontFamilyKey = Config.get("appearance.useEditorFontFamily")
      ? "editor.fontFamily"
      : "terminal.appearance.fontFamily";
    let fontSizeKey = Config.get("appearance.useEditorFontSize")
      ? "editor.fontSize"
      : "terminal.appearance.fontSize";
    let lineHeightKey = Config.get("appearance.useEditorLineHeight")
      ? "editor.lineHeight"
      : "terminal.appearance.lineHeight";

    xtermOptions.fontFamily = lumine.config.get(fontFamilyKey);
    xtermOptions.fontSize = lumine.config.get(fontSizeKey);
    let originalLineHeight = lumine.config.get(lineHeightKey);
    if (xtermOptions.fontSize) {
      let adjustedLineHeight = clampLineHeight(originalLineHeight, xtermOptions.fontSize);
      xtermOptions.lineHeight = adjustedLineHeight;
    }
    xtermOptions.theme = getTheme();

    if (isWindows()) {
      xtermOptions.windowsPty = {
        backend: willUseConPTY() ? "conpty" : "winpty",
        buildNumber: windowsBuildNumber(),
      };
    }

    return structuredClone(xtermOptions);
  }

  setMainBackgroundColor(theme = getTheme()) {
    this.style.backgroundColor = theme?.background ?? "#000000";
  }

  optionallyWarnAboutModifierlessClick() {
    if (!Config.get("advanced.warnAboutModifierWhenOpeningUrls")) {
      return;
    }
    Config.set("advanced.warnAboutModifierWhenOpeningUrls", false);
    lumine.notifications.addInfo(`Terminal: Click ignored`, {
      description: `For security and protection against accidental clicks, you must hold <kbd>${isMac() ? "Cmd" : "Ctrl"}</kbd> while clicking URLs in order to open them in your browser. You may disable this requirement in the package settings. (This message will be shown only once.)`,
      dismissable: true,
      buttons: [
        {
          text: "Open Terminal Settings",
          onDidClick() {
            lumine.workspace.open(`lumine://config/packages/${PACKAGE_NAME}`);
          },
        },
      ],
    });
  }

  async createTerminal() {
    if (this.createdPromise) {
      await this.createdPromise;
    }
    // Create the terminal only once. In specs the element is created directly
    // and then attached, which makes the visibility observer fire a second
    // `createTerminal()` after the first has already finished; without this
    // guard that second call tears the pty down and respawns it, transiently
    // flipping `isPtyProcessRunning()` to false mid-spec. Restarts go through
    // `restartPtyProcess`, not here. (In the app the observer is the sole
    // caller and fires once, so this guard is never hit there.)
    if (this.terminal) return;
    this.createdPromise = this.#createTerminal();
    this.createdPromise.then(() => {
      this.createdPromise = undefined;
    });
    return await this.createdPromise;
  }

  async #createTerminal() {
    this.setMainBackgroundColor();

    // Boot the PTY worker now, and do not wait for it. Building xterm and
    // laying it out takes about as long as the worker takes to start, and the
    // worker needs to know nothing about the shell to start — so run the two
    // side by side instead of one after the other. `restartPtyProcess` picks
    // this up below and tells it what to run. Without this the user watches an
    // empty terminal for the length of a whole Node startup before the shell's
    // first line appears.
    this.#bootingPty = new Pty(undefined, this.getPtyHostOptions());

    // We don't want to start a terminal until the shell environment has been
    // loaded. Otherwise the shell may not inherit the right environment
    // variables.
    //
    // Under normal circumstances, the package won't activate until that
    // happens anyway; but when we restore a project with open terminal
    // windows, the package will activate sooner than we'd ideally want. This
    // enforces that, even when `TerminalElement` is instantiated early, we
    // wait for the shell before proceeding.
    await this.waitForShellEnvironment();

    this.terminal = new XTerminal({
      allowProposedApi: true,
      ...this.getXtermOptions(),
    });

    // This approach is useful when the last key of a would-be key sequence is
    // swallowed by xterm.js. It could be harmonized with the custom key event
    // handler below.
    this.terminal.onKey((event) => {
      // Take keys that were already handled by xterm.js and handle them again
      // in Lumine.
      //
      // It's hard to know exactly when to do this. If we _never_ do it,
      // certain keybindings just won't ever work when the terminal is fully
      // focused. If we _always_ do it, then every single keystroke the user
      // types in the terminal has the potential to both produce a character
      // (or action) in the terminal _and_ trigger a command in the workspace.
      //
      // Right now, we act very cautiously and only redispatch keyboard events
      // if we think that doing so might complete a pending match _related to
      // one of this package's commands_.
      if (this.#keymapHasPendingPartialMatches()) {
        redispatchKeyboardEvent(event.domEvent, this);
      }
    });

    if (Config.get("shellIntegration.enabled")) {
      this.#shellIntegration = new ShellIntegration(this.terminal);
    }

    this.#fitAddon = new FitAddon();
    this.terminal.loadAddon(this.#fitAddon);

    if (Config.get("xterm.webLinks")) {
      this.terminal.loadAddon(
        new WebLinksAddon((event, uri) => {
          if (Config.get("behavior.requireModifierToOpenUrls")) {
            let modifier = isMac() ? event.metaKey : event.ctrlKey;
            if (!modifier) {
              this.optionallyWarnAboutModifierlessClick();
              return;
            }
          }
          lumine.shell.openExternal(uri);
        }),
      );
    }

    if (this.div) {
      this.terminal.open(this.div.terminal);
    }

    if (Config.get("xterm.webgl")) {
      try {
        let webglAddon = new WebglAddon();
        // Activating the addon (via `loadAddon`) is what actually acquires the
        // WebGL2 context, so it — not the constructor — is what throws when the
        // GPU is unavailable or blocklisted. Keep both inside the try.
        this.terminal.loadAddon(webglAddon);
        // If the context is lost later, drop the addon so xterm falls back to
        // its default renderer instead of rendering nothing.
        webglAddon.onContextLoss(() => webglAddon.dispose());
      } catch {
        console.warn("terminal.xterm.webgl is enabled, but this platform does not support WebGL2");
      }
    }

    if (Config.get("xterm.images")) {
      // Loaded after `open()` so the addon hooks whichever renderer the WebGL
      // block above settled on. `enableSizeReports` is left at its default so
      // that the CSI 14/16/18 t reports an image-producing program uses to size
      // its output actually answer.
      this.#imageAddon = new ImageAddon({
        storageLimit: Config.get("xterm.imageStorageLimit"),
      });
      this.terminal.loadAddon(this.#imageAddon);
    }

    if (Config.get("xterm.ligatures")) {
      this.#ligaturesAddon = new LigaturesAddon();
      this.terminal.loadAddon(this.#ligaturesAddon);
    }
    this.#searchAddon = new SearchAddon();
    this.terminal.loadAddon(this.#searchAddon);

    // Attach a key event handler so that we get dibs on handling a given key
    // event before the terminal itself.
    this.terminal.attachCustomKeyEventHandler((event) => {
      Logger.log("Inspecting key", event.key, "with raw event:", event);
      const hasModifier = event.ctrlKey || event.altKey || event.metaKey;

      // Any event that would produce a character and does not have a
      // traditional modifier key should definitely be handled by the terminal.
      // This is an easy way to return quickly for the vast majority of key
      // events without even spending time consulting `KeymapManager`.
      if (!hasModifier && event.charCode) {
        Logger.debug(
          "This is a simple keyboard event that will produce a character, so we’ll let xterm.js handle it without checking for bindings that match!",
        );
        return true;
      }

      // Otherwise, let's see if this event would match any keybindings that
      // would trigger any commands defined by this package.
      if (this.#keyboardEventMatchesKeybinding(event)) {
        // It does, so it's worth preempting xterm.js's own key handling and
        // allow this event to bubble so Lumine can handle it.
        //
        // This means that a user can bind one of this package's commands to
        // (e.g.) `Ctrl+C` and shoot themselves in the foot, losing the ability
        // to send SIGINT. But that would be silly of them!
        Logger.warn("Bypassing xterm.js’s handling of this keyboard event!");
        return false;
      }

      // Everything that doesn't match any of this package's keybindings at
      // least gets a chance at being handled by xterm.js. Anything that fails
      // to get handled will bubble up and be handled by Lumine anyway.
      return true;
    });

    this.findPalette = new FindPalette(this.#searchAddon);

    if (this.div) {
      this.div.palette.appendChild(this.findPalette.element);
    }

    this.#ptyMeta.cols = 80;
    this.#ptyMeta.rows = 25;

    this.refitTerminal();

    this.#ptyMeta.running = false;

    this.subscriptions.add(
      // When the terminal receives input, send it to the PTY.
      this.terminal.onData((data) => {
        if (this.isPtyProcessRunning()) {
          this.pty.write(data);
        }
      }),

      // When the user selects text, we might want to automatically copy it to
      // the clipboard.
      this.terminal.onSelectionChange(() => {
        if (!this.terminal) return;
        if (!Config.get("behavior.copyTextOnSelect")) return;

        let text = this.terminal.getSelection();
        if (!text) return;

        let rawLines = text.split(/\r?\n/g);
        let lines = rawLines.map((line) => line.replace(/\s/g, " ").trimRight());
        text = lines.join("\n");
        lumine.clipboard.write(text);
      }),
    );

    await this.restartPtyProcess();
  }

  async waitForShellEnvironment(timeoutMs = 5000) {
    let promise = lumine.runtime.whenShellEnvironmentLoaded();
    if (timeoutMs > 0) {
      // We might want this not to error on timeout, but to just grow impatient
      // and proceed, since it's not necessarily catastrophic if the shell
      // environment doesn't load.
      return await timeout(promise, timeoutMs, { tag: "waitForShellEnvironment" });
    } else {
      return await promise;
    }
  }

  updateTheme() {
    if (!this.terminal) return;
    // Always resolve the theme: `getTheme` also publishes the operative
    // background color as a custom property, which the stylesheet reads.
    let theme = getTheme();
    // A UI-theme change can change the editor scrollbar width, so re-measure and
    // re-apply it to keep the terminal scrollbar in step. The new width takes
    // effect on the next scrollbar layout (any refit).
    let overviewRuler = this.getOverviewRulerOptions();
    // This runs whenever *any* stylesheet is attached to the window, and the
    // resolved colors almost never differ. Assigning `options.theme` throws away
    // xterm's glyph atlas and repaints the whole viewport, so only pay for it
    // when something actually moved.
    let signature = JSON.stringify([theme, overviewRuler]);
    if (signature === this.themeSignature) return;
    this.themeSignature = signature;
    this.setMainBackgroundColor(theme);
    this.terminal.options.theme = { ...theme };
    this.terminal.options.overviewRuler = overviewRuler;
  }

  async showFind(prefilledText) {
    if (!this.terminal || !this.findPalette) return false;
    await this.findPalette.show();
    if (prefilledText) {
      this.findPalette.search(prefilledText);
    }
    return true;
  }

  toggleFind() {
    if (!this.terminal || !this.findPalette) return false;
    this.findPalette.toggle();
    return true;
  }

  hideFind() {
    if (!this.terminal || !this.findPalette) return false;
    this.findPalette.hide();
    this.terminal?.focus();
    return true;
  }

  findNext() {
    if (!this.terminal || !this.findPalette) return false;
    this.findPalette.findNext();
    return true;
  }

  findPrevious() {
    if (!this.terminal || !this.findPalette) return false;
    this.findPalette.findPrevious();
    return true;
  }

  showNotification(message, infoType, { restartButtonText = "Restart", force = false } = {}) {
    if (!Config.get("behavior.showNotifications") && !force) return;
    let messageElement = document.createElement("div");
    let restartButtonElement = document.createElement("button");
    restartButtonElement.appendChild(document.createTextNode(restartButtonText));

    restartButtonElement.addEventListener("click", () => this.restartPtyProcess(), {
      passive: true,
    });
    restartButtonElement.classList.add("btn", `btn-${infoType}`, "terminal__btn-restart");

    messageElement.classList.add(`terminal__notification--${infoType}`);
    messageElement.appendChild(document.createTextNode(message));
    messageElement.appendChild(restartButtonElement);

    if (this.div) {
      this.div.top.replaceChildren();
      this.div.top.appendChild(messageElement);
    }

    switch (infoType) {
      case "success":
        lumine.notifications.addSuccess(message);
        break;
      case "error":
        lumine.notifications.addError(message);
        break;
      case "warning":
        lumine.notifications.addWarning(message);
        break;
      case "info":
        lumine.notifications.addInfo(message);
        break;
      default:
        throw new Error(`Unknown notification type: ${infoType}`);
    }
  }

  async restartPtyProcess() {
    if (this.#ptyMeta?.running) {
      this.pty?.removeAllListeners("exit");
      this.pty?.kill();
      this.#ptyMeta.running = false;
    }

    let cwd = await this.getCwd();

    this.terminal?.reset();

    this.#ptyMeta.options ??= {};
    this.#ptyMeta.command = this.getShellCommand();
    this.#ptyMeta.args = this.getArgs();

    let name = this.getTerminalType();
    let env = this.getEnv();
    let encoding = this.getEncoding();

    this.#ptyMeta.options = { name, cwd, env };
    if (isWindows()) {
      // Use the newer ConPTY that ships with node-pty, as VS Code does. The
      // Windows inbox ConPTY can reject ENABLE_VIRTUAL_TERMINAL_INPUT for a
      // child process, which prevents applications such as Codex from asking
      // xterm for its foreground/background colors. It also forwards extra
      // cursor visibility transitions while a full-screen application draws.
      this.#ptyMeta.options.useConptyDll = true;
    }

    if (encoding && this.#ptyMeta.options) {
      // Only set encoding if there's an actual encoding to set.
      this.#ptyMeta.options.encoding = encoding;
    }

    // Spawn the shell at the size the terminal already is. Left unset, node-pty
    // picks 80x30, so the shell writes its first output at the wrong width and
    // the refit below makes conpty reflow what it just printed — which is
    // visible as the text flickering the instant it appears. `proposeDimensions`
    // measures the container directly, so it is right from the first call.
    let geometry = this.#fitAddon?.proposeDimensions();
    if (geometry && !isUsableGeometry(geometry)) geometry = undefined;
    this.#ptyMeta.options.cols = geometry?.cols || this.pty?.cols;
    this.#ptyMeta.options.rows = geometry?.rows || this.pty?.rows;
    // Record what the shell was spawned at, so the first refit recognises that
    // the geometry has not changed and does not resize it needlessly.
    this.#ptyMeta.cols = this.#ptyMeta.options.cols;
    this.#ptyMeta.rows = this.#ptyMeta.options.rows;

    // A settle window still open for the outgoing shell must not swallow its
    // final output or delay the replacement's first.
    this.#endResizeSettleWindow();

    // Because we `await` after the we check for the presence of the PTY
    // earlier, we need to check again just to make sure.
    if (this.#ptyMeta?.running || this.pty) {
      this.pty?.removeAllListeners("exit");
      this.pty?.kill();
      this.#ptyMeta.running = false;
    }

    this.pty = undefined;
    this.#ptyMeta.running = false;
    this.#hostErrorReported = false;

    try {
      let shell = {
        file: this.#ptyMeta.command ?? "",
        args: this.#ptyMeta.args,
        options: this.#ptyMeta.options,
      };
      // Adopt the worker `#createTerminal` started, if this is the first run
      // and it is still waiting. A restart always gets a fresh one.
      this.pty = this.#bootingPty ?? new Pty(undefined, this.getPtyHostOptions());
      this.#bootingPty = undefined;
      this.uid = this.pty.id;
      if (this.pty.process) {
        this.pty.onData((data) => {
          if (!this.terminal || !this.model || !this.pty) {
            throw new Error("No terminal or model for incoming PTY data");
          }
          // Whenever we receive data, check for an updated title.
          if (!isWindows() && this.pty.title) {
            this.model.title = this.pty.title;
          }
          this.#writeToTerminal(data);
          this.model.handleNewData();
        });

        // Handle the PTY exiting on its own, like if the user runs `exit` or
        // `logout`.
        this.pty.onExit((exitCode) => {
          if (!this.terminal || !this.model) {
            throw new Error("No terminal or model for incoming PTY data");
          }
          this.#ptyMeta.running = false;
          if (!this.leaveOpenAfterExit()) {
            this.model.exit();
          } else {
            this.#writeToTerminal(`[Exited with code ${exitCode}]`);
          }
        });

        // Handle the worker process behind this session dying — a crash inside
        // `node-pty`, or the worker's own uncaught-exception handler. `onExit`
        // cannot cover this: it reports a shell that exited through the worker,
        // which a worker that is gone can no longer tell us about. The shell is
        // not restarted here; a crash loop would then be invisible, and the
        // scrollback of the session that died is worth keeping on screen.
        this.pty.onError((error) => {
          if (this.#hostErrorReported) return;
          this.#hostErrorReported = true;
          this.#ptyMeta.running = false;
          this.showNotification(error.message, "error", { force: true });
          if (this.leaveOpenAfterExit()) {
            this.#writeToTerminal(`\r\n[${error.message}]\r\n`);
          }
        });

        // Only now that both handlers are attached does the shell get to run,
        // so nothing it prints can arrive before there is somewhere to put it.
        let launched = this.pty.launch(shell);

        await this.pty.booted();
        this.#ptyMeta.running = true;
        this.refitTerminal();
        this.focusTerminal();

        if (this.div) {
          this.div.top.replaceChildren();
        }
        await launched;
        this.refitTerminal();
      }
    } catch (error) {
      // If there's an error in spawning the PTY, it will likely surface in
      // async fashion. But even that seems not to be happening in tests!
      // Pointing to an invalid file path for the initial command doesn't seem
      // to trigger any error; it just does nothing indefinitely.
      let message = `Launching ‘${this.#ptyMeta.command}’ raised the following error: ${error.message}`;
      if (error.message.startsWith("File not found:")) {
        message = `Could not find command ‘${this.#ptyMeta.command}’.`;
      }
      // A worker that died during the launch has already said so, in terms that
      // describe what actually happened better than this does.
      if (!this.#hostErrorReported) {
        this.showNotification(message, "error", { force: true });
      }
      this.pty = undefined;
      this.#ptyMeta.running = false;
    }
  }

  clear() {
    this.terminal?.clear();
  }

  sendSignal(signal) {
    if (!isSafeSignal(signal)) {
      Logger.warn("Refusing to send unsafe signal:", signal);
      return false;
    }
    if (!this.terminal) {
      Logger.warn("Cannot send a signal without a terminal");
      return false;
    }
    if (!this.pty) {
      Logger.warn("Cannot send a signal without a PTY");
      return false;
    }

    switch (signal) {
      case "SIGTERM":
        this.destroy();
        return true;
      case "SIGINT":
        this.pty.write("\x03");
        return true;
      case "SIGQUIT":
        this.pty.write("\x1c");
        return true;
      default:
        return false;
    }
  }

  refitTerminal() {
    this.fitTerminal();
    this.resizePtyToTerminal();
  }

  // The interval the editor uses to settle soft-wrap reflows while a pane
  // divider is dragged. The terminal's column rewrap is the same operation on
  // the same gesture, so it follows the same setting rather than growing one
  // of its own.
  #resizeSettleInterval() {
    return lumine.config.get("editor.softWrapDebounceInterval") ?? 100;
  }

  // Coalesces live fits to one per frame, and runs the fit as a TASK. That
  // timing is deliberate: resizing xterm clears its canvas immediately but
  // draws again on the next animation frame, so a fit from inside the
  // rendering phase — a ResizeObserver or rAF callback — would paint one
  // cleared frame before the redraw lands. From a task, the clear and the
  // redraw reach the same paint.
  #scheduleLiveFit() {
    if (this.#liveFitScheduled) return;
    this.#liveFitScheduled = true;
    setTimeout(() => {
      this.#liveFitScheduled = false;
      this.#liveFit();
    }, 0);
  }

  // The per-frame resize path. Rows always track the container — that keeps
  // the prompt glued to the pane edge, and adding or removing rows is cheap.
  // A column change rewraps the whole buffer, so it follows the editor's
  // soft-wrap settling contract: the first change applies immediately, and
  // further ones are deferred until the width has been stable for
  // `editor.softWrapDebounceInterval` milliseconds (0 rewraps on every
  // change).
  #liveFit() {
    if (!this.#canFit()) return;
    let geometry = this.#fitAddon.proposeDimensions();
    if (!geometry || !isUsableGeometry(geometry)) return;
    let cols = geometry.cols;
    let interval = this.#resizeSettleInterval();
    if (cols !== this.terminal.cols && interval > 0) {
      if (this.#colsSettleTimer) {
        // The width is still changing: keep the current wrap and try again
        // once it has been stable for the interval.
        clearTimeout(this.#colsSettleTimer);
        this.#colsSettleTimer = setTimeout(() => {
          this.#colsSettleTimer = null;
          this.#liveFit();
        }, interval);
        cols = this.terminal.cols;
      } else {
        // Leading edge: apply this rewrap now and open the settling window.
        this.#colsSettleTimer = setTimeout(() => {
          this.#colsSettleTimer = null;
        }, interval);
      }
    }
    if (cols === this.terminal.cols && geometry.rows === this.terminal.rows) return;
    this.terminal.resize(cols, geometry.rows);
  }

  #canFit() {
    if (!this.terminal || !this.#fitAddon) return false;
    if (!this.#terminalInitiallyVisible) return false;
    if (!this.#mainContentRect) return false;
    if (this.#mainContentRect.height === 0 || this.#mainContentRect.width === 0) return false;
    return true;
  }

  // Fit xterm to the container immediately on both axes. The full-refit path:
  // font changes, shell launch, and anything else that wants the final
  // geometry right away rather than the live-resize settling above.
  fitTerminal() {
    if (!this.#canFit()) return;
    this.#fitAddon.fit();
  }

  resizePtyToTerminal() {
    if (!this.terminal || !this.#fitAddon) return;
    let geometry = this.#fitAddon.proposeDimensions();
    if (!geometry || !this.isPtyProcessRunning() || !this.pty) {
      return;
    }
    // An unmeasurable proposal would sail through the changed-geometry guard
    // below — NaN equals nothing, itself included — and crash the worker.
    if (!isUsableGeometry(geometry)) return;
    // Only resize when the geometry actually changed. ConPTY repaints its
    // whole screen buffer on every resize, so a redundant one re-emits
    // whatever the shell has printed so far — which is what made an opening
    // terminal show its banner twice, the second copy starting mid-word, and
    // the text jump around before settling. This guard was here originally and
    // was dropped because resizing redundantly "gave better results"; it did,
    // but only because the shell was being spawned at the wrong size and
    // needed correcting. It is spawned at the right size now.
    if (geometry.cols === this.#ptyMeta.cols && geometry.rows === this.#ptyMeta.rows) {
      return;
    }
    this.#beginResizeSettleWindow();
    this.pty.resize(geometry.cols, geometry.rows);
    this.#ptyMeta.cols = geometry.cols;
    this.#ptyMeta.rows = geometry.rows;
  }

  // The single entry point for PTY output. Inside a settle window, chunks
  // accumulate into the current burst; the burst closes on the first quiet
  // gap, or once it is old enough that holding it longer would visibly stall
  // the stream.
  #writeToTerminal(data) {
    if (!this.#settleActive) {
      this.terminal?.write(data);
      return;
    }
    if (!this.#settleChunks) {
      this.#settleChunks = [];
      this.#settleBatchStart = Date.now();
    }
    this.#settleChunks.push(data);
    if (Date.now() - this.#settleBatchStart >= RESIZE_SETTLE_BATCH_MAX_MS) {
      this.#flushSettleBatch();
    } else {
      clearTimeout(this.#settleFlushTimer);
      this.#settleFlushTimer = setTimeout(() => this.#flushSettleBatch(), RESIZE_SETTLE_QUIET_MS);
    }
    this.#armSettleEnd();
  }

  #beginResizeSettleWindow() {
    this.#settleDeadline = Date.now() + RESIZE_SETTLE_MAX_MS;
    if (!this.#settleActive) {
      this.#settleActive = true;
      this.#freezeScrollbar();
    }
    this.#armSettleEnd();
  }

  #armSettleEnd() {
    clearTimeout(this.#settleEndTimer);
    let wait = Math.max(0, Math.min(RESIZE_SETTLE_END_MS, this.#settleDeadline - Date.now()));
    this.#settleEndTimer = setTimeout(() => this.#endResizeSettleWindow(), wait);
  }

  #endResizeSettleWindow() {
    clearTimeout(this.#settleEndTimer);
    this.#settleEndTimer = undefined;
    this.#flushSettleBatch();
    if (!this.#settleActive) return;
    this.#settleActive = false;
    this.classList.remove("terminal--resize-settling");
  }

  #flushSettleBatch() {
    clearTimeout(this.#settleFlushTimer);
    this.#settleFlushTimer = undefined;
    let chunks = this.#settleChunks;
    this.#settleChunks = null;
    if (chunks?.length) {
      this.terminal?.write(SYNC_UPDATE_START + chunks.join("") + SYNC_UPDATE_END);
    }
  }

  // Pin the scrollbar thumb at its current inline geometry for the duration
  // of the settle window. The stylesheet applies these variables with
  // `!important` while the class is set, which outweighs the inline styles
  // xterm keeps writing underneath.
  #freezeScrollbar() {
    let slider = this.querySelector(".xterm-scrollable-element .scrollbar.vertical > .slider");
    if (!slider?.style.height) return;
    this.style.setProperty("--terminal-frozen-slider-height", slider.style.height);
    this.style.setProperty("--terminal-frozen-slider-top", slider.style.top || "0px");
    this.classList.add("terminal--resize-settling");
  }

  async focusTerminal(double = false) {
    await this.ready();
    if (!this.terminal || !this.model) return;
    this.model.setActive();
    this.terminal.focus();
    if (double) {
      // Second focus will send command to pty.
      this.terminal.focus();
    }
  }

  selectAll() {
    this.terminal?.selectAll();
  }

  hide() {
    if (!this.div) return;
    this.div.terminal.style.visibility = "hidden";
  }

  show() {
    if (!this.div) return;
    this.div.terminal.style.visibility = "visible";
  }
}

module.exports = { TerminalElement };

customElements.define("terminal-view", TerminalElement);
