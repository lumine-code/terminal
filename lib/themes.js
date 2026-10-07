const config = require("./config");
const createThemeColorReader = require("./theme-color-reader");

function getTheme() {
  let theme = config.Config.get("appearance.theme");
  let customThemeColors = config.Config.get("appearance.customThemeColors") ?? {};

  // Start with the custom colors as a base. Some of these hard-coded themes
  // will override the custom colors and others won't.
  let colors = {};

  for (let [key, value] of Object.entries(customThemeColors)) {
    colors[key] = value.toRGBAString();
  }

  switch (theme) {
    case "Base16 Tomorrow Dark":
      colors.background = "#1d1f21";
      colors.foreground = "#c5c8c6";
      colors.selectionForeground = "#b4b7b4";
      //  '#e0e0e0';
      colors.cursor = "#ffffff";
      break;
    case "Base16 Tomorrow Light":
      colors.background = "#ffffff";
      colors.foreground = "#1d1f21";
      colors.selectionForeground = "#282a2e";
      //  '#e0e0e0';
      colors.cursor = "#1d1f21";
      break;
    case "Christmas":
      colors.background = "#0c0047";
      colors.foreground = "#f81705";
      colors.selectionForeground = "#298f16";
      colors.cursor = "#009f59";
      break;
    case "City Lights":
      colors.background = "#181d23";
      colors.foreground = "#666d81";
      colors.selectionForeground = "#2a2f38";
      //  '#b7c5d3';
      colors.cursor = "#528bff";
      break;
    case "Dracula":
      colors.background = "#1e1f29";
      colors.foreground = "white";
      colors.selectionForeground = "#44475a";
      colors.cursor = "#999999";
      break;
    case "Grass":
      colors.background = "rgb(19, 119, 61)";
      colors.foreground = "rgb(255, 240, 165)";
      colors.selectionForeground = "rgba(182, 73, 38, .99)";
      colors.cursor = "rgb(142, 40, 0)";
      break;
    case "Homebrew":
      colors.background = "#000000";
      colors.foreground = "rgb(41, 254, 20)";
      colors.selectionForeground = "rgba(7, 30, 155, .99)";
      colors.cursor = "rgb(55, 254, 38)";
      break;
    case "Inverse":
      colors.background = "#ffffff";
      colors.foreground = "#000000";
      colors.selectionForeground = "rgba(178, 215, 255, .99)";
      colors.cursor = "rgb(146, 146, 146)";
      break;
    case "Linux":
      colors.background = "#000000";
      colors.foreground = "rgb(230, 230, 230)";
      colors.selectionForeground = "rgba(155, 30, 7, .99)";
      colors.cursor = "rgb(200, 20, 25)";
      break;
    case "Man Page":
      colors.background = "rgb(254, 244, 156)";
      colors.foreground = "black";
      colors.selectionForeground = "rgba(178, 215, 255, .99)";
      colors.cursor = "rgb(146, 146, 146)";
      break;
    case "Novel":
      colors.background = "rgb(223, 219, 196)";
      colors.foreground = "rgb(77, 47, 46)";
      colors.selectionForeground = "rgba(155, 153, 122, .99)";
      colors.cursor = "rgb(115, 99, 89)";
      break;
    case "Ocean":
      colors.background = "rgb(44, 102, 201)";
      colors.foreground = "white";
      colors.selectionForeground = "rgba(41, 134, 255, .99)";
      colors.cursor = "rgb(146, 146, 146)";
      break;
    case "One Dark":
      colors.background = "#282c34";
      colors.foreground = "#abb2bf";
      colors.selectionForeground = "#9196a1";
      colors.cursor = "#528bff";
      break;
    case "One Light":
      colors.background = "hsl(230, 1%, 98%)";
      colors.foreground = "hsl(230, 8%, 24%)";
      colors.selectionForeground = "hsl(230, 1%, 90%)";
      colors.cursor = "hsl(230, 100%, 66%)";
      break;
    case "Predawn":
      colors.background = "#282828";
      colors.foreground = "#f1f1f1";
      colors.selectionForeground = "rgba(255,255,255,0.25)";
      colors.cursor = "#f18260";
      break;
    case "Pro":
      colors.background = "#000000";
      colors.foreground = "rgb(244, 244, 244)";
      colors.selectionForeground = "rgba(82, 82, 82, .99)";
      colors.cursor = "rgb(96, 96, 96)";
      break;
    case "Red Sands":
      colors.background = "rgb(143, 53, 39)";
      colors.foreground = "rgb(215, 201, 167)";
      colors.selectionForeground = "rgba(60, 25, 22, .99)";
      colors.cursor = "white";
      break;
    case "Red":
      colors.background = "#000000";
      colors.foreground = "rgb(255, 38, 14)";
      colors.selectionForeground = "rgba(7, 30, 155, .99)";
      colors.cursor = "rgb(255, 38, 14)";
      break;
    case "Silver Aerogel":
      colors.background = "rgb(146, 146, 146)";
      colors.foreground = "#000000";
      colors.selectionForeground = "rgba(120, 123, 156, .99)";
      colors.cursor = "rgb(224, 224, 224)";
      break;
    case "Solarized Dark":
      colors.background = "#042029";
      colors.foreground = "#708284";
      colors.selectionForeground = "#839496";
      colors.cursor = "#819090";
      break;
    case "Solarized Light":
      colors.background = "#fdf6e3";
      colors.foreground = "#657a81";
      colors.selectionForeground = "#ece7d5";
      colors.cursor = "#586e75";
      break;
    case "Solid Colors":
      colors.background = "rgb(120, 132, 151)";
      colors.foreground = "#000000";
      colors.selectionForeground = "rgba(178, 215, 255, .99)";
      colors.cursor = "#ffffff";
      break;
    case "Standard": {
      const reader = createThemeColorReader();
      try {
        colors.background = reader.read("--app-background-color", "#000");
        colors.foreground = reader.read("--text-color", "#fff");
        colors.selectionBackground = reader.read("--background-color-selected", "#555");
        colors.selectionForeground = reader.read("--text-color-selected", "#fff");
        colors.cursor = reader.read("--text-color-highlight", "#fff");
      } finally {
        reader.destroy();
      }
      // The standard ANSI palette belongs to xterm. Undefined --standard-*
      // properties must not replace it with empty strings.
      break;
    }
    case "Stylesheet": {
      const reader = createThemeColorReader();
      try {
        colors.background = reader.read(
          "--terminal-background-color",
          "var(--syntax-background-color, #000)",
        );
        colors.foreground = reader.read("--terminal-text-color", "var(--syntax-text-color, #fff)");
        colors.selectionBackground = reader.read(
          "--terminal-selection-background-color",
          "var(--syntax-selection-color, #555)",
        );
        colors.selectionForeground = reader.read(
          "--terminal-selection-text-color",
          "var(--syntax-text-color, #fff)",
        );
        colors.cursor = reader.read("--terminal-cursor-color", "var(--syntax-cursor-color, #fff)");

        colors.black = reader.read("--terminal-color-black");
        colors.red = reader.read("--terminal-color-red");
        colors.green = reader.read("--terminal-color-green");
        colors.yellow = reader.read("--terminal-color-yellow");
        colors.blue = reader.read("--terminal-color-blue");
        colors.magenta = reader.read("--terminal-color-magenta");
        colors.cyan = reader.read("--terminal-color-cyan");
        colors.white = reader.read("--terminal-color-white");

        colors.brightBlack = reader.read("--terminal-color-bright-black");
        colors.brightRed = reader.read("--terminal-color-bright-red");
        colors.brightGreen = reader.read("--terminal-color-bright-green");
        colors.brightYellow = reader.read("--terminal-color-bright-yellow");
        colors.brightBlue = reader.read("--terminal-color-bright-blue");
        colors.brightMagenta = reader.read("--terminal-color-bright-magenta");
        colors.brightCyan = reader.read("--terminal-color-bright-cyan");
        colors.brightWhite = reader.read("--terminal-color-bright-white");

        colors.scrollbarSliderBackground = reader.read("--terminal-scrollbar-color");
        colors.scrollbarSliderHoverBackground = reader.read("--terminal-scrollbar-color");
        colors.scrollbarSliderActiveBackground = reader.read("--terminal-scrollbar-color");
      } finally {
        reader.destroy();
      }
      break;
    }
    case "Config":
      // Do nothing; we're using the custom colors as-is.
      break;
    default:
      console.warn(`[terminal] Unrecognized theme value: ${theme}`);
  }
  // We set the `overviewRuler.width` option when we create the terminal
  // because that also governs the width of the scrollbar. But doing so causes
  // the overview ruler to appear. The easiest way to make it disappear is to
  // theme its border color to match the background color.
  colors.overviewRulerBorder = colors.background;

  // Set a CSS custom property with a value that matches the actual background
  // color we're assigning to the terminal. This value is useful to have in the
  // stylesheet, and `--terminal-background-color` won't agree with reality
  // if the user opts into a legacy theme or applies theme overrides via
  // config.
  document.documentElement.style.setProperty(
    "--terminal-internal-operative-background-color",
    colors.background,
  );
  return colors;
}

// Search colors follow the chosen terminal theme. Config colors are already
// converted to sRGB by getTheme; only Stylesheet reads the package variables.
function getSearchTheme() {
  const theme = config.Config.get("appearance.theme");
  const configured = getTheme();
  const colors = {
    matchBorder: configured.matchBorder,
    activeMatchBorder: configured.activeMatchBorder,
    matchBackground: configured.matchBackground,
    activeMatchBackground: configured.activeMatchBackground,
    matchOverviewRuler: "#00000000",
    activeMatchColorOverviewRuler: "#00000000",
  };
  if (theme === "Stylesheet") {
    const reader = createThemeColorReader();
    try {
      colors.matchBorder = reader.read("--terminal-result-marker-color");
      colors.activeMatchBorder = reader.read("--terminal-result-marker-color-selected");
      colors.matchBackground = reader.read("--terminal-background-color");
      colors.activeMatchBackground = reader.read("--terminal-selection-background-color");
    } finally {
      reader.destroy();
    }
  } else {
    colors.matchBorder ??= configured.foreground;
    colors.activeMatchBorder ??= configured.foreground;
    colors.matchBackground ??= configured.background;
    colors.activeMatchBackground ??= configured.selectionBackground ?? configured.background;
  }
  return colors;
}

module.exports = { getTheme, getSearchTheme };
