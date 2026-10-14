# Terminal guide

The terminal package runs a real shell inside the workspace. See the [package README](../README.md) for installation and the complete command list.

## Opening a terminal

`terminal:open` opens a new terminal in the default location. To choose where it goes, use `terminal:open-center`, `terminal:open-bottom-dock`, `terminal:open-left-dock`, `terminal:open-right-dock`, or split the active pane with `terminal:open-split-up` / `-down` / `-left` / `-right`. `terminal:focus` focuses the active terminal, or creates one if none is open. Cycle between open terminals with `terminal:focus-next` and `terminal:focus-previous`.

The default `ctrl-backquote` binding focuses the active terminal, creates one if needed, and returns focus to the editor when the terminal already has it. `backquote` names the physical key rather than the character printed by the active keyboard layout. Terminal chords begin with `ctrl-shift-backquote`: press `n` for a new terminal, an arrow for a split, `b` / `l` / `r` for a dock, `x` / `i` in an editor to run or insert its selection, and `w` / `s` in a terminal to close or restart it.

A focused terminal handles most other keystrokes itself, so use `terminal:unfocus` — bound to the same `ctrl-backquote` shortcut — before another Lumine keybinding will fire. On Windows and Linux, copy and paste use `Ctrl+Shift+C` and `Ctrl+Shift+V`.

## Running editor text

`terminal:run-selected-text` sends the editor's current selection to the active terminal and runs it; `terminal:insert-selected-text` inserts it without pressing Enter.

## Opening links

Hold Alt and left-click a local filesystem path to choose its opener and window destination with Open With. File paths can include compiler-style line and column suffixes such as `file.js:42:7`; choosing an editor opener preserves that location. Hold Ctrl and Alt while left-clicking to open the path externally instead. External opening uses the `open-external` service when available, honoring handlers registered by other packages, and falls back to the system otherwise.

Hold Alt and Shift while left-clicking a local path to reveal it in the system file manager. Shift and Ctrl-Shift clicks retain normal terminal selection.

Web URLs and OSC 8 hyperlinks with web or mailto destinations open in their system application with Alt and a left-click. OSC 8 hyperlinks to local `file:` paths use the same Open With and external gestures as detected paths.

Alt reveals links on every platform. While it is held, a link under the mouse is underlined and the cursor becomes a pointer. Pressing or releasing Alt updates both indicators immediately, even while the mouse stays still. Ordinary mouse movement and clicking keep the terminal's normal behavior.

## Finding in scrollback

`terminal:find` opens an in-terminal find palette, with `terminal:find-next` and `terminal:find-previous` to step through matches, and `terminal:set-selection-as-find-pattern` to search for the currently selected text.

The terminal keeps 10,000 lines of scrollback by default; adjust **Scrollback** in the package settings.

## Images

The terminal draws images written with SIXEL or iTerm's inline image protocol in place, so `imgcat`, `chafa` and matplotlib's sixel backend render in the terminal instead of opening a window. Turn it off under **Inline Images**, and cap how much memory each terminal spends on decoded images under **Inline Image Memory Limit** — past the cap the oldest images are dropped and leave a placeholder in the scrollback.

Pasting an image goes the other way. A clipboard holding an image has no text to paste, so instead of writing nothing the terminal hands the paste to Lumine's paste providers. With the [`image-paste`](https://github.com/lumine-code/image-paste) package installed, the normal paste command — or `terminal:paste-image` — asks where to save the image, writes it relative to the terminal's working directory, and types the saved file's absolute path onto the input line. Nothing is submitted for you, and the path is quoted only if it contains a space.

That is how you hand a screenshot to a command-line program, including the coding agents that accept an image by path. Agents that read the clipboard themselves keep working too: the terminal claims no bare `alt-` letter, so a binding like `alt-v` reaches the program rather than Lumine.

## Shell integration

The terminal automatically integrates with bash, zsh, fish and PowerShell when their configured startup arguments can be preserved safely. It tracks the current working directory after `cd`, carries that directory into restarts and copied terminals, marks each command's prompt in the left gutter — tinted red when the command exited non-zero — and enables navigation with `terminal:previous-command` and `terminal:next-command`. Unsupported shells or custom startup arguments fall back to the unmodified shell, and externally configured OSC 133 or OSC 633 integration remains recognized.

Shell integration is enabled by default. Change **Enable Shell Integration** in the package settings and restart the terminal for the new setting to apply.

## Appearance

The terminal derives its colors from the active UI theme by default — it sits in a dock, so it takes panel colors and blends with the surrounding chrome. It draws with a WebGL renderer that falls back to xterm's DOM renderer. Override any color by redefining its CSS custom property (for example `--terminal-color-red`) in your `styles.css`. Coding-font ligatures such as `==` and `>=` can be enabled in settings.
