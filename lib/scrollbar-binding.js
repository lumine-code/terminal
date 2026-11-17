// Xterm owns scrollbar geometry and dragging. Lumine owns when its chrome is
// visible, so the renderer must not schedule its separate scroll hide timer.
// Keep the xterm 6 boundary here, beside the document adoption binding.
function bindTerminalScrollbar(terminal, element, onChange = () => {}) {
  const scrollable = terminal._core?._viewport?._scrollableElement;
  const vertical = scrollable?._verticalScrollbar;
  if (
    typeof scrollable?.setRevealOnScroll !== "function" ||
    typeof scrollable?.onScroll !== "function" ||
    typeof scrollable?._hideTimeout?.cancel !== "function" ||
    typeof vertical?.isNeeded !== "function"
  )
    throw new Error("Terminal: Unsupported xterm scrollbar binding API.");

  scrollable.setRevealOnScroll(false);
  scrollable._hideTimeout.cancel();
  let canScroll = vertical.isNeeded();
  let presented = element.classList.contains("terminal--scrollbar-scrollable");
  let disposed = false;
  const refresh = () => {
    if (disposed) return;
    const needed = vertical.isNeeded();
    if (needed !== canScroll) {
      canScroll = needed;
      onChange(needed);
    }
    if (element.classList.contains("terminal--resize-settling") || needed === presented) return;
    presented = needed;
    element.classList.toggle("terminal--scrollbar-scrollable", needed);
  };
  // This event follows xterm's scrollbar state update, including dimensions,
  // buffer switches and parser output; no native DOM measurements are needed.
  const subscription = scrollable.onScroll(refresh);
  refresh();
  return {
    get canScroll() {
      return !disposed && canScroll;
    },
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      subscription.dispose();
      element.classList.remove("terminal--scrollbar-scrollable");
    },
  };
}

module.exports = { bindTerminalScrollbar };
