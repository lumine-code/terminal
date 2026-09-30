// xterm does not expose its built-in OSC 8 provider through the public API.
// Keep this compatibility boundary in one place; the adapter spec checks the
// installed xterm version before the controller wraps any providers.
function getLinkProviders(terminal) {
  const providers = terminal._core?._linkProviderService?.linkProviders;
  if (
    !Array.isArray(providers) ||
    providers.some((provider) => typeof provider.provideLinks !== "function")
  ) {
    throw new Error("Terminal: Unsupported xterm link provider API.");
  }
  return providers.slice();
}

class AltLinkController {
  #terminal;
  #listeners = [];
  #providers = [];
  #activeLink;
  #altPressed = false;
  #inside = false;
  #disposed = false;
  #cursorMoveOption;
  #gesture;
  #restoreTimer;

  constructor(terminal, element) {
    this.#terminal = terminal;
    for (const provider of getLinkProviders(terminal)) {
      const original = provider.provideLinks;
      const controller = this;
      function provideLinks(line, callback) {
        return original.call(this, line, (links) => {
          // A filesystem lookup can finish after the terminal is closed.
          if (controller.#disposed) return;
          callback(links?.map((link) => controller.#wrapLink(link)));
        });
      }
      provider.provideLinks = provideLinks;
      this.#providers.push({ provider, original, wrapped: provideLinks });
    }

    const doc = element.ownerDocument;
    this.#listen(doc, "keydown", (event) => this.#setAlt(event.key === "Alt" || event.altKey));
    this.#listen(doc, "keyup", (event) => this.#setAlt(event.key !== "Alt" && event.altKey));
    this.#listen(element, "mousemove", (event) => {
      this.#inside = true;
      this.#setAlt(event.altKey);
    });
    this.#listen(element, "mouseleave", (event) => {
      if (event.target !== element && element.contains(event.relatedTarget)) return;
      this.#inside = false;
      this.#setAlt(false);
    });
    this.#listen(element, "mousedown", (event) => {
      if (event.button !== 0 || !event.altKey || !this.#activeLink || !this.#inside) return;
      this.#restoreCursorMovement();
      this.#cursorMoveOption = terminal.options.altClickMovesCursor;
      this.#gesture = {};
      terminal.options.altClickMovesCursor = false;
    });
    this.#listen(doc, "mouseup", () => {
      if (!this.#gesture) return;
      const gesture = this.#gesture;
      // SelectionService handles mouseup on the document after Linkifier has
      // activated the link. Keep the option disabled through that handler.
      clearTimeout(this.#restoreTimer);
      this.#restoreTimer = setTimeout(() => {
        this.#restoreTimer = undefined;
        if (this.#gesture === gesture) this.#restoreCursorMovement();
      }, 0);
    });
    this.#listen(doc.defaultView, "blur", (event) => {
      // Capture also sees textarea and other descendant blur events. Moving
      // keyboard focus within the window does not move the mouse off a link.
      if (event.target !== doc.defaultView) return;
      this.#inside = false;
      this.#setAlt(false);
      this.#restoreCursorMovement();
    });
  }

  #listen(target, type, handler) {
    target.addEventListener(type, handler, true);
    this.#listeners.push(() => target.removeEventListener(type, handler, true));
  }

  #setAlt(value) {
    this.#altPressed = Boolean(value);
    if (this.#activeLink) {
      const visible = this.#altPressed && this.#inside;
      this.#activeLink.decorations.underline = visible;
      this.#activeLink.decorations.pointerCursor = visible;
    }
  }

  #decorations() {
    const controller = this;
    // Linkifier replaces this object with live setters on hover. Its setters
    // reference the current link, so cached links must receive fresh getters
    // on leave instead of retaining setters aimed at a different link.
    return {
      get underline() {
        return !controller.#disposed && controller.#inside && controller.#altPressed;
      },
      get pointerCursor() {
        return !controller.#disposed && controller.#inside && controller.#altPressed;
      },
    };
  }

  #wrapLink(link) {
    const controller = this;
    const original = { ...link };
    Object.assign(link, {
      decorations: this.#decorations(),
      hover(...args) {
        controller.#activeLink = link;
        return original.hover?.apply(link, args);
      },
      leave(...args) {
        if (controller.#activeLink === link) controller.#activeLink = undefined;
        link.decorations = controller.#decorations();
        return original.leave?.apply(link, args);
      },
      activate(event, ...args) {
        if (!controller.#disposed && event.altKey && event.button === 0) {
          return original.activate.call(link, event, ...args);
        }
      },
      dispose(...args) {
        if (controller.#activeLink === link) {
          link.decorations.underline = false;
          link.decorations.pointerCursor = false;
          controller.#activeLink = undefined;
        }
        return original.dispose?.apply(link, args);
      },
    });
    return link;
  }

  #restoreCursorMovement() {
    clearTimeout(this.#restoreTimer);
    this.#restoreTimer = undefined;
    if (!this.#gesture) return;
    this.#terminal.options.altClickMovesCursor = this.#cursorMoveOption;
    this.#gesture = undefined;
    this.#cursorMoveOption = undefined;
  }

  dispose() {
    if (this.#disposed) return;
    this.#setAlt(false);
    this.#activeLink = undefined;
    this.#disposed = true;
    this.#restoreCursorMovement();
    for (const removeListener of this.#listeners) removeListener();
    this.#listeners.length = 0;
    for (const { provider, original, wrapped } of this.#providers) {
      if (provider.provideLinks === wrapped) provider.provideLinks = original;
    }
    this.#providers.length = 0;
  }
}

module.exports = { AltLinkController, getLinkProviders };
