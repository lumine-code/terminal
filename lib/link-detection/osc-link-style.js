// xterm 6 stores OSC 8 links as extended cell attributes that force a dashed
// underline in both renderers, independently of ILink.decorations. Adapt only
// this terminal's attributes so AltLinkController owns the hover decoration
// while genuine ANSI underline styles and OSC 8 metadata remain intact.
function suppressOscLinkUnderline(terminal) {
  const inputHandler = terminal._core?._inputHandler;
  const initial = inputHandler?.getAttrData?.()?.extended;
  const Base = initial?.constructor;
  const style = Object.getOwnPropertyDescriptor(Base?.prototype ?? {}, "underlineStyle");
  if (
    typeof initial?.clone !== "function" ||
    typeof style?.get !== "function" ||
    typeof style?.set !== "function"
  ) {
    throw new Error("Terminal: Unsupported xterm OSC 8 attribute API.");
  }

  class LinkAttributes extends Base {
    get underlineStyle() {
      const id = this.urlId;
      this.urlId = 0;
      try {
        return super.underlineStyle;
      } finally {
        this.urlId = id;
      }
    }

    set underlineStyle(value) {
      super.underlineStyle = value;
    }

    clone() {
      // The inherited ext getter now packs the real ANSI style. WebGL reads
      // this same value, so it also avoids the intrinsic OSC 8 underline.
      return new LinkAttributes(this.ext, this.urlId);
    }
  }

  const hook = terminal.parser.registerOscHandler(8, () => {
    // Reset can replace the current attribute object. Adapt it lazily before
    // the default handler clones it to start or finish the next hyperlink.
    const attrs = inputHandler.getAttrData();
    const original = attrs.extended;
    if (!(original instanceof LinkAttributes)) {
      const id = original.urlId;
      original.urlId = 0;
      try {
        attrs.extended = new LinkAttributes(original.ext, id);
      } finally {
        original.urlId = id;
      }
    }
    // Keep xterm's parsing, URI validation, link registration and cleanup.
    return false;
  });

  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      hook.dispose();
      const attrs = inputHandler.getAttrData();
      if (attrs.extended instanceof LinkAttributes) {
        attrs.extended = new Base(attrs.extended.ext, attrs.extended.urlId);
      }
      // Buffered attributes belong to this terminal and remain adapted until
      // terminal.dispose() removes the buffer alongside the renderer.
    },
  };
}

module.exports = { suppressOscLinkUnderline };
