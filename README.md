# terminal

An embedded terminal emulator.

Runs real system shells inside the workspace, rendered with [xterm.js](https://xtermjs.org/) and driven by [node-pty](https://github.com/lumine-code/node-pty), a native module this package installs and builds itself.

## Features

- **Real shells**: spawns system shells such as bash, zsh, fish, PowerShell, and cmd through node-pty.
- **xterm.js rendering**: draws output with xterm.js and an optional WebGL renderer that falls back to DOM rendering.
- **Flexible placement**: opens terminals in the workspace center, any dock, or a split of the active pane.
- **Editor integration**: runs or inserts the editor's selected text in the active terminal.
- **Clickable links**: opens URLs in the browser, and OSC 8 file links in the editor or the file manager.
- **Find**: searches the scrollback with an in-terminal find palette.
- **Theming**: derives its colors from the active UI theme, or from explicit color settings.
- **Ligatures**: optionally renders coding-font ligatures such as `==` and `>=`.
- **Inline images**: draws images written with SIXEL or iTerm's inline image protocol in place.
- **Image paste**: hands a clipboard image to whichever package saves it and writes its path back.

## Installation

To install `terminal` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/terminal`.

## Commands

Commands available in `lumine-workspace`:

- `terminal:focus`: focus the active terminal, or create one in the default location if none is open,
- `terminal:open`: open a new terminal in the default location,
- `terminal:open-center`: open a new terminal in the workspace center,
- `terminal:open-bottom-dock`: open a new terminal in the bottom dock,
- `terminal:open-left-dock`: open a new terminal in the left dock,
- `terminal:open-right-dock`: open a new terminal in the right dock,
- `terminal:open-split-up`: open a new terminal by splitting the active pane upward,
- `terminal:open-split-down`: open a new terminal by splitting the active pane downward,
- `terminal:open-split-left`: open a new terminal by splitting the active pane leftward,
- `terminal:open-split-right`: open a new terminal by splitting the active pane rightward,
- `terminal:focus-next`: focus the next terminal,
- `terminal:focus-previous`: focus the previous terminal,
- `terminal:run-selected-text`: run the editor's selected text in the active terminal,
- `terminal:insert-selected-text`: insert the editor's selected text into the active terminal,
- `terminal:close`: close the active terminal,
- `terminal:close-all`: close every open terminal.

Commands available in `terminal-view`:

- `terminal:find`: open the find palette,
- `terminal:find-next`: jump to the next find match,
- `terminal:find-previous`: jump to the previous find match,
- `terminal:set-selection-as-find-pattern`: use the selected terminal text as the find pattern,
- `terminal:clear`: clear the terminal screen,
- `terminal:send-sigint`: send an interrupt (SIGINT) to the running process,
- `terminal:previous-command`: scroll to the previous command's prompt,
- `terminal:next-command`: scroll to the next command's prompt,
- `terminal:paste-image`: save the clipboard image and write its path into the terminal,
- `terminal:restart`: restart the terminal's process,
- `terminal:unfocus`: move focus from the terminal to its pane container.

## Usage

When a terminal is focused it handles most keystrokes itself, so some Lumine commands may not fire until you move focus out of it with `terminal:unfocus`.

### Inline images

The terminal renders images written with SIXEL or iTerm's inline image protocol, so tools such as `imgcat`, `chafa` and matplotlib's sixel backend draw in place instead of opening a window. Decoded images are held per terminal up to **Inline Image Memory Limit**; once it is reached the oldest are dropped and leave a placeholder behind in the scrollback.

### Pasting an image

Pasting works the other way. A clipboard holding an image has no text to paste, so the terminal offers the paste to Lumine's paste providers rather than writing nothing: with the [`image-paste`](https://github.com/lumine-code/image-paste) package installed, the normal paste command — or `terminal:paste-image` — saves the image relative to the terminal's working directory and writes the saved file's absolute path onto the input line. Nothing is submitted for you, and the path is quoted only when it contains a space.

That is how you hand a screenshot to a command-line program, including the coding agents that accept an image by path. A program that reads the clipboard itself is unaffected: the terminal claims no bare `alt-` letter, so an agent that binds one of them to its own image paste keeps working.

## Configuration

The terminal recognizes OSC 133 shell-integration sequences. When your shell emits them, each command's prompt is marked in the left gutter — tinted red when the command exited non-zero — and you can jump between prompts with `terminal:previous-command` and `terminal:next-command`.

This is off until your shell emits the sequences. Reference scripts live in this package's `shell-integration/` folder; source the one for your shell:

- **bash** — in `~/.bashrc`: `source <package>/shell-integration/lumine.bash`
- **zsh** — in `~/.zshrc`: `source <package>/shell-integration/lumine.zsh`
- **PowerShell** — in your `$PROFILE`: `. <package>/shell-integration/lumine.ps1`

The feature can be toggled under **Shell Integration** in the package settings.

## Customization

The terminal treats CSS custom properties on `:root` as the source of truth for its colors. Redefine any of them in your `styles.css` to override the defaults:

```css
:root {
  --terminal-color-red: #ff5555;
  --terminal-color-green: #50fa7b;
  --terminal-cursor-color: #f8f8f2;
}
```

## Services

- [`terminal`](docs/terminal.md): provided to let other packages open terminals and run commands in them.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
