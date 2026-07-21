// Shell integration via OSC 133 (the FinalTerm / iTerm2 protocol).
//
// A suitably-configured shell emits these sequences to mark command
// boundaries; see the `shell-integration/` reference scripts and the README.
// When it does, we mark each command's prompt line, decorate it by exit status,
// and expose prompt-to-prompt navigation.
//
//   OSC 133 ; A ST                   prompt start
//   OSC 133 ; B ST                   prompt end (command input starts)
//   OSC 133 ; C ST                   command output starts
//   OSC 133 ; D [; <exit-code>] ST   command finished
//
// If the shell never emits these sequences this class simply does nothing, so
// it is safe to enable unconditionally.

class ShellIntegration {
  constructor(terminal) {
    this.terminal = terminal;
    this.commands = [];
    this.currentCommand = null;
    this.disposables = [];

    this.disposables.push(
      terminal.parser.registerOscHandler(133, (data) => {
        this.#handle(data);
        return true;
      }),
    );
  }

  #handle(data) {
    // Payloads can carry extra `key=value` parameters after the type; we only
    // need the leading type character and, for "D", the exit code.
    let [type, ...params] = data.split(";");
    switch (type) {
      case "A":
        this.#startCommand();
        break;
      case "D":
        this.#finishCommand(params[0]);
        break;
      // "B" (prompt end) and "C" (output start) are recognized but unused.
    }
  }

  #startCommand() {
    // A marker at the cursor's line tracks this command's prompt row even as the
    // buffer scrolls; it disposes itself once that row leaves the scrollback.
    let marker = this.terminal.registerMarker(0);
    if (!marker) return;
    this.currentCommand = { marker, exitCode: undefined, decoration: null };
  }

  #finishCommand(exitCodeParam) {
    if (!this.currentCommand) return;
    let exitCode = exitCodeParam === undefined ? undefined : Number.parseInt(exitCodeParam, 10);
    this.currentCommand.exitCode = Number.isNaN(exitCode) ? undefined : exitCode;
    this.#decorate(this.currentCommand);
    this.commands.push(this.currentCommand);
    this.currentCommand = null;
  }

  #decorate(command) {
    let marker = command.marker;
    if (!marker || marker.isDisposed) return;
    let decoration = this.terminal.registerDecoration({ marker, x: 0, width: 1 });
    if (!decoration) return;
    let failed = command.exitCode !== undefined && command.exitCode !== 0;
    decoration.onRender((element) => {
      element.classList.add("terminal-command-decoration");
      element.classList.toggle("terminal-command-decoration--error", failed);
    });
    command.decoration = decoration;
  }

  // The buffer lines of every known command prompt, ascending.
  #promptLines() {
    let markers = this.commands.map((command) => command.marker);
    if (this.currentCommand) markers.push(this.currentCommand.marker);
    return markers
      .filter((marker) => marker && !marker.isDisposed)
      .map((marker) => marker.line)
      .sort((a, b) => a - b);
  }

  scrollToPreviousCommand() {
    let top = this.terminal.buffer.active.viewportY;
    let target = null;
    for (let line of this.#promptLines()) {
      if (line < top) target = line;
      else break;
    }
    if (target !== null) this.terminal.scrollToLine(target);
  }

  scrollToNextCommand() {
    let top = this.terminal.buffer.active.viewportY;
    let target = this.#promptLines().find((line) => line > top);
    if (target !== undefined) this.terminal.scrollToLine(target);
  }

  dispose() {
    for (let disposable of this.disposables) disposable.dispose();
    for (let command of this.commands) command.decoration?.dispose();
    this.currentCommand?.decoration?.dispose();
    this.commands = [];
    this.currentCommand = null;
  }
}

module.exports = ShellIntegration;
