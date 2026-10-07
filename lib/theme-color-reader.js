// Resolve a CSS custom property through a color property before handing it to
// xterm. Its parser accepts sRGB strings, not relative CSS color expressions.
module.exports = function createThemeColorReader(element = document.documentElement) {
  const doc = element.ownerDocument;
  const probe = doc.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;color:inherit;";
  element.appendChild(probe);
  let context;
  return {
    read(name, fallback) {
      let declared = doc.defaultView.getComputedStyle(element).getPropertyValue(name).trim();
      if (declared && !doc.defaultView.CSS.supports("color", declared)) declared = "";
      if (!declared && fallback === undefined) return undefined;
      probe.style.color = fallback ?? "inherit";
      if (declared) probe.style.color = declared;
      const color = doc.defaultView.getComputedStyle(probe).color || fallback;
      if (/^rgba?\(/.test(color)) return color;
      context ??= doc.createElement("canvas").getContext("2d", { willReadFrequently: true });
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    },
    destroy() {
      probe.remove();
    },
  };
};
