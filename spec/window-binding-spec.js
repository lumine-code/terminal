const { bindTerminalWindow } = require("../lib/window-binding");

describe("Terminal presentation frame transfer", () => {
  it("retires all old-window queues and repaints them in the destination", () => {
    const oldWindow = {
      cancelAnimationFrame: jasmine.createSpy("old frame cancellation"),
      clearInterval: jasmine.createSpy("old interval cancellation"),
      document: { removeEventListener: jasmine.createSpy("old pointer listeners") },
    };
    const newWindow = {};
    const selection = {
      _refreshAnimationFrame: 12,
      _dragScrollIntervalTimer: 14,
      _mouseMoveListener() {},
      _mouseUpListener() {},
      refresh: jasmine.createSpy("selection redraw"),
    };
    const ruler = { _animationFrame: 13, _queueRefresh: jasmine.createSpy("ruler redraw") };
    const viewport = {
      getScrollPosition: () => ({ scrollTop: 120, scrollLeft: 0 }),
      setScrollPosition: jasmine.createSpy("stop smooth scrolling"),
    };
    const blink = {
      isPaused: false,
      pause: jasmine.createSpy("pause source cursor"),
      resume: jasmine.createSpy("resume destination cursor"),
    };
    const core = {
      _document: oldWindow.document,
      _coreBrowserService: { window: oldWindow, isFocused: true },
      _renderService: {
        _renderDebouncer: { _animationFrame: 11 },
        _renderer: { value: { _cursorBlinkStateManager: { value: blink } } },
      },
      _selectionService: selection,
      _overviewRulerRenderer: ruler,
      _viewport: { _scrollableElement: viewport },
    };
    const parent = { ownerDocument: { defaultView: newWindow } };
    const terminal = {
      _core: core,
      rows: 24,
      open() {
        core._coreBrowserService.window = newWindow;
      },
      refresh: jasmine.createSpy("terminal redraw"),
    };
    bindTerminalWindow(terminal, parent);
    expect(oldWindow.cancelAnimationFrame.calls.allArgs()).toEqual([[11], [12], [13]]);
    expect(oldWindow.clearInterval).toHaveBeenCalledWith(14);
    expect(oldWindow.document.removeEventListener).toHaveBeenCalledWith(
      "mousemove",
      selection._mouseMoveListener,
    );
    expect(oldWindow.document.removeEventListener).toHaveBeenCalledWith(
      "mouseup",
      selection._mouseUpListener,
    );
    expect(viewport.setScrollPosition).toHaveBeenCalledWith({ scrollTop: 120, scrollLeft: 0 });
    expect(selection._refreshAnimationFrame).toBeUndefined();
    expect(ruler._animationFrame).toBeUndefined();
    expect(selection.refresh).toHaveBeenCalled();
    expect(ruler._queueRefresh).toHaveBeenCalledWith(true);
    expect(blink.pause).toHaveBeenCalledBefore(blink.resume);
    expect(blink.resume).toHaveBeenCalledTimes(1);
    expect(core._document).toBe(parent.ownerDocument);
  });
});
