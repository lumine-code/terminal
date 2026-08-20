const { CompositeDisposable } = require("lumine");
const { Config, getConfigSchema, possiblySetAutoShell } = require("./config");
const { TerminalElement } = require("./element");
const { isSafeSignal, TerminalModel } = require("./model");
const { PtyHost } = require("./pty");
const { BASE_URI, coalesce, recalculateActive, generateUri } = require("./utils");
const Logger = require("./log");
const etch = require("@lumine-code/etch");

// Etch holds its scheduler per copy of the library, and this package resolves
// its own copy — so the assignment the editor makes on core's copy never
// reaches it. Point it at the view registry before anything renders, or this
// package's DOM writes land on an animation frame of their own alongside the
// editor's and force a synchronous reflow.
etch.setScheduler(lumine.views);

// The elements a context-menu command may be dispatched from: an editor, a
// tree-view entry, or a tab. Kept in step with the same selector in
// `menus/main.json`, which decides where the items appear; this one decides
// where they are allowed to run.
const CONTEXT_MENU_SCOPE =
  "lumine-text-editor:not([mini]), .tree-view .full-menu .entry:not(.tree-view-special-root), lumine-pane[data-active-item-path] .tab.active";

class Terminal {
  static config = getConfigSchema();

  static activated = false;

  static activate(_state) {
    this.activated = true;
    this.subscriptions = new CompositeDisposable();
    this.terminals = new Set();

    Logger.initialize();

    // Attempt to detect the correct shell on Windows, but only if we haven't
    // done so on a previous activation.
    possiblySetAutoShell();

    // A context-menu command opens a terminal for whatever was right-clicked,
    // so the clicked element decides both the working directory and — for the
    // command that honors the user's default container — which pane container
    // that default is applied in.
    const resolveContextMenuOptions = (target) => {
      let result = {};
      if (!(target instanceof HTMLElement)) return result;

      let cwd = this.getPath(target);
      if (cwd) result.cwd = cwd;

      if (target.closest(".tree-view")) {
        // The tree view is itself a dock item, so its own container is the
        // sidebar. A terminal opened from it belongs in the workspace center,
        // not squeezed in beside the tree.
        result.location = "center";
      } else {
        // `getPaneContainers()` is heterogeneous: the three docks are `Dock`s
        // and expose `getElement()`, while the center is a `WorkspaceCenter`
        // wrapping a pane container it never hands out. So ask the docks by
        // containment, and read anything else in a pane container as the
        // center's, which is the only one left.
        let dock = lumine.workspace
          .getPaneContainers()
          .find((paneContainer) => paneContainer.getElement?.().contains(target));
        if (dock) {
          result.location = dock.getLocation();
        } else if (target.closest("lumine-pane-container")) {
          result.location = "center";
        }
      }

      return result;
    };

    this.subscriptions.add(
      // Register a view provider for the terminal emulator.
      lumine.views.addViewProvider(TerminalModel, (model) => {
        let element = new TerminalElement();
        element.initialize(model);
        return element;
      }),

      // Add an opener for the terminal emulator.
      lumine.workspace.addOpener((uri) => {
        if (!uri.startsWith(BASE_URI)) return undefined;
        let item = new TerminalModel({
          uri,
          terminals: this.terminals,
        });
        return item;
      }),

      // Keep track of where terminal pane items are moved.
      lumine.workspace.observePanes((pane) => {
        this.subscriptions.add(
          pane.observeItems((item) => {
            if (TerminalModel.is(item)) {
              item.moveToPane(pane);
            }
            recalculateActive(this.terminals);
          }),
        );
        recalculateActive(this.terminals);
      }),

      // Add callbacks to run for current and future active items on active
      // panes.
      lumine.workspace.observeActivePaneItem((item) => {
        // Move focus into the terminal when the item is a terminal item.
        if (TerminalModel.is(item)) {
          item.focusTerminal();
        }
        recalculateActive(this.terminals);
      }),

      // Commands.
      lumine.commands.add("lumine-workspace", {
        "terminal:focus": {
          description: "Focus the active terminal, opening one if there is none.",
          didDispatch: () => this.focus(),
        },
        "terminal:open": {
          description: "Open a terminal wherever the settings say new ones go.",
          didDispatch: () => {
            this.open(this.generateUri(), this.addDefaultPosition());
          },
        },
        "terminal:close": {
          description: "End the active terminal's session and close its tab.",
          didDispatch: () => {
            this.close();
          },
        },
        "terminal:open-center": {
          description: "Open a terminal as a tab in the editor area.",
          didDispatch: () => {
            this.openInCenterOrDock(lumine.workspace.getCenter());
          },
        },
        "terminal:open-split-up": {
          description: "Open a terminal in a pane above the active one.",
          didDispatch: () => {
            this.open(this.generateUri(), { split: "up" });
          },
        },
        "terminal:open-split-down": {
          description: "Open a terminal in a pane below the active one.",
          didDispatch: () => {
            this.open(this.generateUri(), { split: "down" });
          },
        },
        "terminal:open-split-left": {
          description: "Open a terminal in a pane to the left of the active one.",
          didDispatch: () => {
            this.open(this.generateUri(), { split: "left" });
          },
        },
        "terminal:open-split-right": {
          description: "Open a terminal in a pane to the right of the active one.",
          didDispatch: () => {
            this.open(this.generateUri(), { split: "right" });
          },
        },
        "terminal:open-bottom-dock": {
          description: "Open a terminal in the dock along the bottom.",
          didDispatch: () => {
            this.openInCenterOrDock(lumine.workspace.getBottomDock());
          },
        },
        "terminal:open-left-dock": {
          description: "Open a terminal in the dock along the left.",
          didDispatch: () => {
            this.openInCenterOrDock(lumine.workspace.getLeftDock());
          },
        },
        "terminal:open-right-dock": {
          description: "Open a terminal in the dock along the right.",
          didDispatch: () => {
            this.openInCenterOrDock(lumine.workspace.getRightDock());
          },
        },
        "terminal:close-all": {
          description: "End every terminal session and close all their tabs.",
          didDispatch: () => {
            this.exitAllTerminals();
          },
        },
        "terminal:insert-selected-text": {
          description: "Type the editor selection into the terminal, unrun.",
          didDispatch: () => {
            this.insertSelection();
          },
        },
        "terminal:run-selected-text": {
          description: "Send the editor selection to the terminal and run it.",
          didDispatch: () => {
            this.runSelection();
          },
        },
        "terminal:focus-next": {
          description: "Move focus to the next terminal that is open.",
          didDispatch: () => this.focusNext(),
        },
        "terminal:focus-previous": {
          description: "Move focus to the previous terminal that is open.",
          didDispatch: () => this.focusPrevious(),
        },
      }),
      lumine.commands.add("terminal-view", {
        "core:copy": (event) => {
          return this.copy(event);
        },
        "core:paste": (event) => {
          return this.paste(event);
        },
        "terminal:paste-image": {
          description: "Write the clipboard image to a file and paste its path.",
          didDispatch: (event) => {
            return this.pasteImage(this.inferTerminalModel(event), { explicit: true });
          },
        },
        "core:select-all": (event) => {
          return this.selectAll(event);
        },
        "terminal:send-sigint": {
          description: "Interrupt whatever the terminal is running, as Ctrl-C does.",
          didDispatch: (event) => {
            let element = this.inferTerminalElement(event);
            if (!element || !element.terminal) return;
            return element.sendSignal("SIGINT");
          },
        },
        "terminal:set-selection-as-find-pattern": {
          description: "Search the terminal for whatever is selected in it.",
          didDispatch: (event) => {
            let element = this.inferTerminalElement(event);
            if (!element || !element.terminal) return;
            let selection = element.terminal.getSelection();

            let didShow = element.showFind(selection);
            if (!didShow) event.abortKeyBinding();
          },
        },
        "terminal:restart": {
          description: "End this terminal's session and start a fresh one in place.",
          didDispatch: (event) => {
            return this.restart(event);
          },
        },
        "terminal:unfocus": {
          description: "Return focus to the editor, leaving the terminal open.",
          didDispatch: () => {
            return this.unfocus();
          },
        },
        "terminal:clear": {
          description: "Wipe the scrollback, leaving the session running.",
          didDispatch: (event) => {
            return this.clear(event);
          },
        },
        "terminal:find": {
          description: "Search the terminal's scrollback for text.",
          didDispatch: (event) => {
            let element = this.inferTerminalElement(event);
            if (!element) return;

            let didShow = element.showFind();
            if (!didShow) event.abortKeyBinding();
          },
        },
        "terminal:find-next": {
          description: "Move to the next match in the terminal's scrollback.",
          didDispatch: (event) => {
            let element = this.inferTerminalElement(event);
            if (!element) return;

            let didRespond = element.findNext();
            if (!didRespond) event.abortKeyBinding();
          },
        },
        "terminal:find-previous": {
          description: "Move to the previous match in the terminal's scrollback.",
          didDispatch: (event) => {
            let element = this.inferTerminalElement(event);
            if (!element) return;

            let didRespond = element.findPrevious();
            if (!didRespond) event.abortKeyBinding();
          },
        },
        "terminal:previous-command": {
          description: "Scroll back to where the previous command was entered.",
          didDispatch: (event) => {
            this.inferTerminalElement(event)?.scrollToPreviousCommand();
          },
        },
        "terminal:next-command": {
          description: "Scroll on to where the next command was entered.",
          didDispatch: (event) => {
            this.inferTerminalElement(event)?.scrollToNextCommand();
          },
        },
      }),

      lumine.commands.add(".terminal-find-palette lumine-text-editor", {
        "core:cancel": (event) => {
          let element = this.inferTerminalElement(event);
          if (!element) return;

          let didHide = element.hideFind();
          if (!didHide) event.abortKeyBinding();
        },
      }),

      // Commands for the right-click context menu. Each one opens a terminal
      // in the directory of whatever was clicked: a tree-view entry, a tab's
      // file, or the editor's file, falling back to the project root when the
      // click yields no path.
      //
      // Every command but `terminal:open-context-menu` names its own
      // destination, so only that one reads the location the click resolved
      // to; the rest need nothing from the click but the directory.
      lumine.commands.add(CONTEXT_MENU_SCOPE, {
        "terminal:open-context-menu": {
          hiddenInCommandPalette: true,
          didDispatch: ({ target }) => {
            let { cwd, ...opts } = resolveContextMenuOptions(target);
            this.open(this.generateUri(cwd ? { cwd } : {}), this.addDefaultPosition(opts));
          },
        },
        "terminal:open-center-context-menu": {
          hiddenInCommandPalette: true,
          didDispatch: ({ target }) => {
            let { cwd } = resolveContextMenuOptions(target);
            this.open(this.generateUri(cwd ? { cwd } : {}), { location: "center" });
          },
        },
        "terminal:open-split-up-context-menu": {
          hiddenInCommandPalette: true,
          didDispatch: ({ target }) => {
            let { cwd } = resolveContextMenuOptions(target);
            this.open(this.generateUri(cwd ? { cwd } : {}), { split: "up", location: "center" });
          },
        },
        "terminal:open-split-down-context-menu": {
          hiddenInCommandPalette: true,
          didDispatch: ({ target }) => {
            let { cwd } = resolveContextMenuOptions(target);
            this.open(this.generateUri(cwd ? { cwd } : {}), { split: "down", location: "center" });
          },
        },
        "terminal:open-split-left-context-menu": {
          hiddenInCommandPalette: true,
          didDispatch: ({ target }) => {
            let { cwd } = resolveContextMenuOptions(target);
            this.open(this.generateUri(cwd ? { cwd } : {}), { split: "left", location: "center" });
          },
        },
        "terminal:open-split-right-context-menu": {
          hiddenInCommandPalette: true,
          didDispatch: ({ target }) => {
            let { cwd } = resolveContextMenuOptions(target);
            this.open(this.generateUri(cwd ? { cwd } : {}), { split: "right", location: "center" });
          },
        },
        "terminal:open-split-bottom-dock-context-menu": {
          hiddenInCommandPalette: true,
          didDispatch: ({ target }) => {
            let { cwd } = resolveContextMenuOptions(target);
            this.open(this.generateUri(cwd ? { cwd } : {}), { location: "bottom" });
          },
        },
        "terminal:open-split-left-dock-context-menu": {
          hiddenInCommandPalette: true,
          didDispatch: ({ target }) => {
            let { cwd } = resolveContextMenuOptions(target);
            this.open(this.generateUri(cwd ? { cwd } : {}), { location: "left" });
          },
        },
        "terminal:open-split-right-dock-context-menu": {
          hiddenInCommandPalette: true,
          didDispatch: ({ target }) => {
            let { cwd } = resolveContextMenuOptions(target);
            this.open(this.generateUri(cwd ? { cwd } : {}), { location: "right" });
          },
        },
      }),
    );

    // Coalesced rather than debounced: a theme switch attaches its stylesheets
    // inside a View Transition, and the terminal has to re-read them in the
    // same task to be part of the cross-fade. See `coalesce` in `./utils`.
    let updateTheme = coalesce(() => this.updateTheme());

    this.subscriptions.add(
      // Immediately apply new theme colors if anything changes in the
      // "appearance" section.
      lumine.config.onDidChange("terminal.appearance", updateTheme),
      // Immediately apply new theme colors if the user changes their syntax or
      // UI theme.
      lumine.themes.onDidChangeActiveThemes(updateTheme),
      // This should catch any changes to the user’s `styles.css`. (Strangely,
      // when the user edits their `styles.css`, it's removed and re-added
      // rather than updated, it would seem.) It is also what fires during a
      // theme switch, before `onDidChangeActiveThemes` does.
      lumine.styles.onDidAddStyleElement(updateTheme),
    );

    let docks = [
      lumine.workspace.getRightDock(),
      lumine.workspace.getLeftDock(),
      lumine.workspace.getBottomDock(),
    ];

    let dockDisposables = docks.map((dock) => {
      return dock.observeVisible((visible) => {
        if (visible) {
          let item = dock.getActivePaneItem();
          if (TerminalModel.is(item)) {
            item.focusTerminal();
          }
        }
        recalculateActive(this.terminals);
      });
    });

    this.subscriptions.add(...dockDisposables);
  }

  static inferTerminalModel(event) {
    if (!event) {
      return this.getActiveTerminal();
    }
    let element = this.inferTerminalElement(event);
    return element?.getModel() ?? this.getActiveTerminal();
  }

  static inferTerminalElement(event) {
    if (!event.target || !(event.target instanceof HTMLElement)) return null;
    return event.target.closest("terminal-view");
  }

  static async open(uri, options = {}) {
    let url = new URL(uri);
    // Copied so filling in the location below never writes into the caller's
    // object.
    let opts = { ...options };
    // When calling `lumine.workspace.open` with a URI, Lumine does not consider
    // the active pane container when choosing a location for the new item. So
    // we must force it to do so by inspecting the active pane container and
    // turning it into a string suitable for passing to `options.location`.
    opts.location ??= this.getActiveWorkspaceLocation();
    if (opts.target && opts.target instanceof HTMLElement && !url.searchParams.has("cwd")) {
      let cwd = this.getPath(opts.target);
      if (cwd) {
        url.searchParams.set("cwd", cwd);
      }
    }

    Logger.debug("Opening with options:", opts, url.href);

    return await lumine.workspace.open(url.href, opts);
  }

  static getActiveWorkspaceLocation(activeContainer) {
    activeContainer ??= lumine.workspace.getActivePaneContainer();
    switch (activeContainer) {
      case lumine.workspace.getCenter():
        return "center";
      case lumine.workspace.getBottomDock():
        return "bottom";
      case lumine.workspace.getLeftDock():
        return "left";
      case lumine.workspace.getRightDock():
        return "right";
      default:
        return undefined;
    }
  }

  static close() {
    let active = this.getActiveTerminal();
    if (!active) return;
    active.exit();
  }

  static restart(event) {
    let model = this.inferTerminalModel(event);
    if (!model) return;
    model.restartPtyProcess();
  }

  static copy(event) {
    let model = this.inferTerminalModel(event);
    if (!model) return;
    let text = model.getSelection();
    lumine.clipboard.write(text ?? "");
  }

  static paste(event) {
    let model = this.inferTerminalModel(event);
    if (!model) return;

    let textToPaste = lumine.clipboard.read();
    if (textToPaste) {
      model.paste(textToPaste);
      return;
    }

    // A clipboard holding only an image reads as empty text, so writing it to
    // the pty would do nothing at all. Offer the paste to the registry first:
    // that is how a package like `image-paste` gets to save the image and type
    // its path, which is the only form a program running in the shell can read.
    this.pasteImage(model);
  }

  /**
   * Offer this terminal's paste to the paste providers, so one of them can turn
   * a clipboard image into a file and write its path into the terminal.
   *
   * Returns `true` when a provider claimed the paste.
   */
  static pasteImage(model, { explicit = false } = {}) {
    if (!model) return false;

    let claimed = lumine.pasteProviders.handlePaste({
      target: { type: "terminal", model, path: model.cwd },
      clipboard: lumine.clipboard,
      explicit,
    });
    if (claimed) return true;

    // Nothing claimed it. An empty clipboard is not worth a notification — a
    // provider that recognized the image and declined has already said so —
    // but an image nobody can handle means no image-paste-style package is
    // installed, and the user is owed the reason nothing happened.
    if (!lumine.clipboard.readImage().isEmpty()) {
      lumine.notifications.addWarning("No package is installed to paste images into a terminal.", {
        description:
          "Install the `image-paste` package to save a clipboard image into the project and write its path into the terminal.",
      });
    }
    return false;
  }

  static selectAll(event) {
    let model = this.inferTerminalModel(event);
    if (!model) return;
    model.selectAll();
  }

  static clear(event) {
    let model = this.inferTerminalModel(event);
    if (!model) return;
    model.clear();
  }

  /**
   * Service function for opening a terminal.
   */
  static async openTerminal(options = {}) {
    options = this.addDefaultPosition(options);
    let result = await this.open(this.generateUri(), options);
    // An open can decline, e.g. when the workspace center is full.
    if (!result) return null;
    result.focusTerminal();
    return result;
  }

  /**
   * Function for sending a signal to the active terminal.
   *
   * It's risky to allow arbitrary control of a terminal to another package.
   * The `run` method gets around it by prompting the user with the exact
   * command that was requested to run. This method gets around it by allowing
   * only one of three signals: `SIGINT`, `SIGQUIT`, or `SIGTERM`.
   */
  // Intentionally not exposed via the package service: it would need the same
  // user-approval safeguards as `run`.
  static async sendSignal(signal) {
    if (!isSafeSignal(signal)) return;

    let terminal = this.getActiveTerminal();
    if (!terminal || !terminal.element) return false;
    await terminal.element.ready();

    terminal.element.sendSignal(signal);
  }

  static async canRunCommands(commands) {
    let serializedCommands = JSON.stringify(commands);
    if ((Config.get("advanced.allowedCommands") ?? []).includes(serializedCommands)) {
      return true;
    }
    let disposable = undefined;
    return new Promise((resolve) => {
      let notification = lumine.notifications.addInfo("Terminal: Approve commands", {
        description: `A package wants to run the command(s) above. If this is OK, click **Allow Once**. You may also choose **Allow Always** to remember your approval for this specific list of commands.`,
        detail: commands.join("\n"),
        dismissable: true,
        buttons: [
          {
            text: "Refuse",
            className: "btn-error",
            onDidClick() {
              disposable?.dispose();
              notification.dismiss();
              resolve(false);
            },
          },
          {
            text: "Allow Once",
            onDidClick() {
              disposable?.dispose();
              notification.dismiss();
              resolve(true);
            },
          },
          {
            text: "Allow Always",
            onDidClick() {
              disposable?.dispose();
              let allowedCommands = Config.get("advanced.allowedCommands") ?? [];
              Config.set("advanced.allowedCommands", [...allowedCommands, serializedCommands]);
              notification.dismiss();
              resolve(true);
            },
          },
        ],
      });

      // If the user dismisses the notification via the close icon, it'll be
      // treated the same as if they'd clicked “Refuse.”
      //
      // If one of the other buttons is clicked first, in theory this
      // disposable will be disposed of before it can execute.
      disposable = notification.onDidDismiss(() => {
        disposable?.dispose();
        resolve(false);
      });
    });
  }

  /**
   * Service function which opens a terminal and runs the given commands.
   *
   * Configuration determines whether a new terminal is opened or an existing
   * terminal is reused.
   *
   * Returns a boolean indicating whether the commands actually ran. There are
   * several reasons why the commands might not run, including: (a) the
   * terminal wasn’t yet active, and (b) the user might not have approved the
   * requested commands.
   */
  static async runCommands(commands) {
    let terminal;
    if (Config.get("behavior.runInActive")) {
      terminal = this.getActiveTerminal();
    }
    if (!terminal) {
      terminal = await this.open(this.generateUri(), this.addDefaultPosition());
    }
    // An open can decline, e.g. when the workspace center is full.
    if (!terminal?.element) return false;
    await terminal.element.ready();

    // Ensure these commands are approved by the user — either already
    // whitelisted or shown to the user in a prompt so that they can
    // approve/reject.
    if (!(await this.canRunCommands(commands))) {
      return false;
    }

    for (let command of commands) {
      terminal.run(command);
    }
    return true;
  }

  static async openInCenterOrDock(centerOrDock, options = {}) {
    let location;
    switch (centerOrDock) {
      case lumine.workspace.getBottomDock():
        location = "bottom";
        break;
      case lumine.workspace.getLeftDock():
        location = "left";
        break;
      case lumine.workspace.getRightDock():
        location = "right";
        break;
      case lumine.workspace.getCenter():
        location = "center";
        break;
      default:
        location = undefined;
    }
    options.location ??= location;
    let { cwd, ...opts } = options;
    let uri = cwd ? this.generateUri({ cwd }) : this.generateUri();
    return await this.open(uri, opts);
  }

  // Given an element that the user clicked on, attempt to infer a path.
  static getPath(target) {
    if (!target) {
      let [firstPath] = lumine.project.getPaths();
      return firstPath ?? null;
    }

    let treeView = target.closest(".tree-view");
    if (treeView) {
      // The clicked row, if the click landed on one; the tree is a flat list of
      // rows, each carrying its own `getPath`. Falling back to the selection
      // covers a click that landed between rows.
      let entry = target.closest(".entry") ?? treeView.querySelector(".entry.selected");
      // A special-root section header is excluded: its `getPath()` is a
      // synthetic `special-root://` URI, not a directory a shell can start in.
      if (!entry || entry.classList.contains("tree-view-special-root")) return null;
      return entry.getPath?.() ?? null;
    }

    // A tab is an `li.tab`, and it is its title element that carries the path.
    let tab = target.closest(".tab-bar .tab");
    if (tab) {
      let title = tab.querySelector(".title");
      return title?.dataset.path ?? null;
    }

    let textEditor = target.closest("lumine-text-editor");
    if (textEditor && typeof textEditor.getModel === "function") {
      let model = textEditor.getModel();
      return model.getPath?.() ?? null;
    }

    return null;
  }

  // Given an existing set of options to pass to `lumine.workspace.open`,
  // augments it with the default destination, if needed.
  static addDefaultPosition(options = {}) {
    // Copied so the defaults below land on the returned object, never on the
    // caller's.
    options = { ...options };
    let position = Config.get("behavior.defaultContainer");
    switch (position) {
      case "Center": {
        let pane = lumine.workspace.getActivePane();
        if (pane && !("pane" in options)) {
          options.pane = pane;
        }
        break;
      }
      case "Split Up":
        if (!("split" in options)) {
          options.split = "up";
        }
        break;
      case "Split Down":
        if (!("split" in options)) {
          options.split = "down";
        }
        break;
      case "Split Left":
        if (!("split" in options)) {
          options.split = "left";
        }
        break;
      case "Split Right":
        if (!("split" in options)) {
          options.split = "right";
        }
        break;
      case "Bottom Dock": {
        let pane = lumine.workspace.getBottomDock().getActivePane();
        if (pane && !("pane" in options)) {
          options.pane = pane;
        }
        break;
      }
      case "Left Dock": {
        let pane = lumine.workspace.getLeftDock().getActivePane();
        if (pane && !("pane" in options)) {
          options.pane = pane;
        }
        break;
      }
      case "Right Dock": {
        let pane = lumine.workspace.getRightDock().getActivePane();
        if (pane && !("pane" in options)) {
          options.pane = pane;
        }
        break;
      }
    }
    return options;
  }

  static deactivate() {
    this.exitAllTerminals();
    // The shared worker process outlives any one terminal, so nothing else
    // will end it.
    PtyHost.releaseShared();
    Logger.destroy();
    this.subscriptions?.dispose();
  }

  static updateTheme() {
    for (let terminal of this.terminals) {
      terminal.updateTheme();
    }
  }

  static deserializeTerminalModel(serializedModel) {
    // Because the config schema is provided at runtime, we must activate this
    // package before we can read the `relaunchTerminalsOnStartup` value. This
    // contradicts our desire to wait to activate until the
    // `core:loaded-shell-environment` hook.
    let pack = lumine.packages.enablePackage("terminal");
    if (!pack) return;
    // Undocumented. Requires the main module and registers the runtime config
    // schema, so `Config.get` below has something to read.
    pack.activateNow();

    if (!Config.get("behavior.relaunchTerminalsOnStartup")) {
      return;
    }
    return new TerminalModel({
      uri: serializedModel.uri,
      terminals: this.terminals,
    });
  }

  static exitAllTerminals() {
    for (let terminal of this.terminals) {
      terminal.exit();
    }
  }

  static insertSelection() {
    let selection = this.getSelectedText();
    if (!selection) return;
    this.performOnActiveTerminal((term) => term.paste(selection));
  }

  static async runSelection() {
    let selection = this.getSelectedText();
    if (!selection) return;
    this.performOnActiveTerminal((term) => term.run(selection), { create: true });
  }

  static async performOnActiveTerminal(operation, { create = false } = {}) {
    let terminal = create ? await this.getOrCreateActiveTerminal() : this.getActiveTerminal();
    if (!terminal) return;
    operation(terminal);
  }

  static async getOrCreateActiveTerminal() {
    let activeTerminal = this.getActiveTerminal();
    if (!activeTerminal) {
      activeTerminal = await this.openTerminal();
    }
    return activeTerminal;
  }

  static getActiveTerminal() {
    return Array.from(this.terminals).find((term) => term.isActive());
  }

  static getSelectedText() {
    let editor = lumine.workspace.getActiveTextEditor();
    if (!editor) return "";

    let selectedText = "";
    let selection = editor.getSelectedText();
    if (selection) {
      selectedText = selection.replace(/[\r\n]+$/, "");
    } else {
      let cursor = editor.getCursorBufferPosition();
      if (cursor) {
        let line = editor.lineTextForBufferRow(cursor.row);
        selectedText = line;
        editor.moveDown(1); // Advance so repeated runs send successive lines.
      }
    }

    return selectedText;
  }

  static focus() {
    if (this.terminals.size === 0) {
      this.openTerminal();
      return;
    }

    let activeTerminal = Array.from(this.terminals).find((term) => term.activeIndex === 0);
    activeTerminal?.focusTerminal(true);
  }

  static focusNext() {
    if (this.terminals.size === 0) {
      this.openTerminal();
      return;
    }

    let list = Array.from(this.terminals);
    let nextIndex = list.findIndex((t) => t.activeIndex === 0) + 1;
    if (nextIndex >= list.length) {
      nextIndex -= list.length;
    }
    list[nextIndex].focusTerminal(true);
  }

  static focusPrevious() {
    if (this.terminals.size === 0) {
      this.openTerminal();
      return;
    }

    let list = Array.from(this.terminals);
    let prevIndex = list.findIndex((t) => t.activeIndex === 0) - 1;
    if (prevIndex < 0) {
      prevIndex += list.length;
    }
    list[prevIndex].focusTerminal(true);
  }

  static unfocus() {
    lumine.views.getView(lumine.workspace).focus();
  }

  static generateUri(params = {}) {
    return generateUri(params);
  }

  // SERVICES
  // ========

  static provideTerminal() {
    return {
      run: (commands) => {
        return this.runCommands(commands);
      },
      open: () => {
        return this.openTerminal();
      },
    };
  }
}

module.exports = Terminal;
