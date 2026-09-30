const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { expect, test } = require("@playwright/test");
const {
  closeLumine,
  openLumine,
  openTerminal,
  waitForShellToSettle,
  TERMINAL_ELEMENT_SELECTOR,
} = require("./helpers");

// Use actual keyboard and pointer input against the DOM renderer. Reading its
// rendered underline and computed cursor checks the visible result, including
// the xterm boundary that synthetic provider-only specs cannot exercise.
test.describe("Alt-only terminal links", () => {
  let app, page, temporaryRoot;

  test.beforeEach(async () => {
    ({ app, page, temporaryRoot } = await openLumine());
    await page.evaluate(() => lumine.config.set("terminal.xterm.webgl", false));
    await openTerminal(page);
    await waitForShellToSettle(page);
    await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      // Stop shell output before putting deterministic text into the terminal.
      // The xterm input observer still detects any unwanted Alt-click data.
      element.pty.kill();
      window.linkTest = { opened: [], input: [] };
      element.terminal.onData((data) => window.linkTest.input.push(data));
      lumine.shell.openExternal = async (uri) => window.linkTest.opened.push(uri);
      lumine.workspace.open = async (target) => window.linkTest.opened.push(target);
      element.terminal.reset();
      element.terminal.focus();
    }, TERMINAL_ELEMENT_SELECTOR);
  });

  test.afterEach(async () => {
    await closeLumine({ app, temporaryRoot });
  });

  async function write(text) {
    await page.evaluate(
      ({ selector, text }) =>
        new Promise((resolve) => document.querySelector(selector).terminal.write(text, resolve)),
      { selector: TERMINAL_ELEMENT_SELECTOR, text },
    );
    await expect(page.locator(".xterm-rows")).toContainText("link");
    // Render first: xterm suspends background rendering. CDP still supplies
    // native input while hidden, without interference from the desktop mouse.
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.hide();
    });
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((window) => window.isVisible()),
        ),
      )
      .toBe(false);
    await page.evaluate(
      (selector) => document.querySelector(selector).terminal.focus(),
      TERMINAL_ELEMENT_SELECTOR,
    );
  }

  async function pointAt(column = 2) {
    const point = await page.evaluate(
      ({ selector, column }) => {
        const terminal = document.querySelector(selector).terminal;
        const rect = terminal.element.querySelector(".xterm-screen").getBoundingClientRect();
        return {
          x: rect.left + ((column + 0.5) * rect.width) / terminal.cols,
          y: rect.top + (0.5 * rect.height) / terminal.rows,
        };
      },
      { selector: TERMINAL_ELEMENT_SELECTOR, column },
    );
    await page.mouse.move(point.x, point.y);
    return point;
  }

  async function appearance() {
    return page.evaluate((selector) => {
      const terminal = document.querySelector(selector).terminal;
      const screen = terminal.element.querySelector(".xterm-screen");
      return {
        pointer: getComputedStyle(screen).cursor === "pointer",
        underline: [...terminal.element.querySelectorAll(".xterm-rows span")].some((span) =>
          getComputedStyle(span).textDecorationLine.includes("underline"),
        ),
      };
    }, TERMINAL_ELEMENT_SELECTOR);
  }

  for (const kind of ["web URL", "OSC 8", "local path"]) {
    test(`${kind}: stationary Alt changes both styles and opens once without PTY input`, async () => {
      const targetPath = path.join(temporaryRoot, "link.txt");
      await fs.promises.writeFile(targetPath, "fixture");
      const target = kind === "web URL" ? "https://link.example.com/" : targetPath;
      const text =
        kind === "web URL"
          ? target
          : kind === "OSC 8"
            ? `\x1b]8;;${pathToFileURL(targetPath).href}\x07link\x1b]8;;\x07`
            : targetPath;
      await write(`${text}  ordinary text\r\n`);
      const point = await pointAt();

      await expect.poll(appearance).toEqual({ pointer: false, underline: false });
      await page.mouse.click(point.x, point.y);
      expect(await page.evaluate(() => window.linkTest.opened)).toEqual([]);

      for (const modifier of ["Control", "Meta"]) {
        await page.keyboard.down(modifier);
        await expect.poll(appearance).toEqual({ pointer: false, underline: false });
        await page.mouse.click(point.x, point.y);
        await page.keyboard.up(modifier);
        expect(await page.evaluate(() => window.linkTest.opened)).toEqual([]);
      }

      // No mouse input between these assertions: modifier changes must update
      // the native cursor and rendered underline on their own.
      await page.keyboard.down("Alt");
      await expect.poll(appearance).toEqual({ pointer: true, underline: true });
      await page.keyboard.up("Alt");
      await expect.poll(appearance).toEqual({ pointer: false, underline: false });
      await page.keyboard.down("Alt");
      await expect.poll(appearance).toEqual({ pointer: true, underline: true });

      await page.evaluate(() => (window.linkTest.input = []));
      await page.mouse.click(point.x, point.y);
      await page.keyboard.up("Alt");
      expect(await page.evaluate(() => window.linkTest.opened)).toEqual([target]);
      expect(await page.evaluate(() => window.linkTest.input)).toEqual([]);
      await expect
        .poll(() =>
          page.evaluate(
            (selector) => document.querySelector(selector).terminal.options.altClickMovesCursor,
            TERMINAL_ELEMENT_SELECTOR,
          ),
        )
        .toBe(true);
      await expect.poll(appearance).toEqual({ pointer: false, underline: false });
    });
  }
});
