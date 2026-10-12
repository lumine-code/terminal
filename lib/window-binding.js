// xterm 6 keeps the terminal and buffer alive when open() observes a new
// ownerDocument. Its mouse-reporting document remains cached on the core;
// keep that narrow compatibility boundary beside the presentation binding.
function bindTerminalWindow(terminal, parent) {
  const core = terminal._core;
  if (!core || !core._coreBrowserService || !core._document)
    throw new Error("Terminal: Unsupported xterm document binding API.");
  const previousWindow = core._coreBrowserService.window;
  const debouncer = core._renderService?._renderDebouncer;
  if (debouncer?._animationFrame != null) {
    previousWindow.cancelAnimationFrame(debouncer._animationFrame);
    debouncer._animationFrame = undefined;
  }
  terminal.open(parent);
  core._document = parent.ownerDocument;
  core._coreBrowserService.mainDocument = parent.ownerDocument;
  terminal.refresh(0, terminal.rows - 1);
}

function capturePosition(terminal, position) {
  const buffer = terminal.buffer.active;
  let line = position.y;
  while (line > 0 && buffer.getLine(line)?.isWrapped) line--;
  return {
    marker: terminal.registerMarker(line - buffer.baseY - buffer.cursorY),
    offset: (position.y - line) * terminal.cols + position.x,
  };
}

function captureTerminalView(terminal) {
  const selection = terminal.getSelectionPosition();
  const buffer = terminal.buffer.active;
  return {
    type: buffer.type,
    start: selection && capturePosition(terminal, selection.start),
    end: selection && capturePosition(terminal, selection.end),
    viewport:
      buffer.viewportY !== buffer.baseY && capturePosition(terminal, { x: 0, y: buffer.viewportY }),
  };
}

function restoreTerminalView(terminal, state) {
  const position = (anchor) =>
    anchor?.marker && !anchor.marker.isDisposed
      ? {
          x: anchor.offset % terminal.cols,
          y: anchor.marker.line + Math.floor(anchor.offset / terminal.cols),
        }
      : null;
  if (terminal.buffer.active.type !== state.type) return;
  const start = position(state.start),
    end = position(state.end);
  if (start && end)
    terminal.select(start.x, start.y, (end.y - start.y) * terminal.cols + end.x - start.x);
  const viewport = position(state.viewport);
  if (viewport) terminal.scrollToLine(viewport.y);
  else if (!state.viewport) terminal.scrollToBottom();
}

function releaseTerminalView(state) {
  for (const anchor of [state.start, state.end, state.viewport]) anchor?.marker?.dispose();
}

module.exports = {
  bindTerminalWindow,
  captureTerminalView,
  restoreTerminalView,
  releaseTerminalView,
};
