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
  #shiftPressed = false;
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
    this.#listen(doc, "keydown", (event) => this.#setModifiers(event, true));
    this.#listen(doc, "keyup", (event) => this.#setModifiers(event, false));
    this.#listen(element, "mousemove", (event) => {
      this.#inside = true;
      this.#setModifiers(event);
    });
    this.#listen(element, "mouseleave", (event) => {
      if (event.target !== element && element.contains(event.relatedTarget)) return;
      this.#inside = false;
      this.#setModifiers({});
    });
    this.#listen(element, "mousedown", (event) => {
      if (!this.#activeLink || !this.#inside || !this.#allowsActivation(this.#activeLink, event))
        return;
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
      this.#setModifiers({});
      this.#restoreCursorMovement();
    });
  }

  #listen(target, type, handler) {
    target.addEventListener(type, handler, true);
    this.#listeners.push(() => target.removeEventListener(type, handler, true));
  }

  #isLocalLink(link) {
    return typeof link?.localPath === "string" || /^file:/i.test(link?.text ?? "");
  }

  #allowsActivation(link, event) {
    return event.button === 0 && (event.altKey || (event.shiftKey && this.#isLocalLink(link)));
  }

  #isVisible(link) {
    return this.#inside && (this.#altPressed || (this.#shiftPressed && this.#isLocalLink(link)));
  }

  #setModifiers(event, pressed) {
    this.#altPressed = event.key === "Alt" ? pressed : Boolean(event.altKey);
    this.#shiftPressed = event.key === "Shift" ? pressed : Boolean(event.shiftKey);
    if (this.#activeLink) {
      const visible = this.#isVisible(this.#activeLink);
      this.#activeLink.decorations.underline = visible;
      this.#activeLink.decorations.pointerCursor = visible;
    }
  }

  #decorations(link) {
    const controller = this;
    // Linkifier replaces this object with live setters on hover. Its setters
    // reference the current link, so cached links must receive fresh getters
    // on leave instead of retaining setters aimed at a different link.
    return {
      get underline() {
        return !controller.#disposed && controller.#isVisible(link);
      },
      get pointerCursor() {
        return !controller.#disposed && controller.#isVisible(link);
      },
    };
  }

  #wrapLink(link) {
    const controller = this;
    const original = { ...link };
    Object.assign(link, {
      decorations: this.#decorations(link),
      hover(...args) {
        controller.#activeLink = link;
        return original.hover?.apply(link, args);
      },
      leave(...args) {
        if (controller.#activeLink === link) controller.#activeLink = undefined;
        link.decorations = controller.#decorations(link);
        return original.leave?.apply(link, args);
      },
      activate(event, ...args) {
        if (!controller.#disposed && controller.#allowsActivation(link, event)) {
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
    this.#setModifiers({});
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
