const fs = require("fs");
const os = require("os");
const path = require("path");
const { expect, test } = require("@playwright/test");
const {
  closeLumine,
  openLumine,
  openTerminal,
  readTerminalContents,
  waitForShellToSettle,
  TERMINAL_ELEMENT_SELECTOR,
} = require("./helpers");

const SHELL_NAME = path.basename(
  process.env.TERMINAL_E2E_SHELL || process.env.SHELL || process.env.COMSPEC || "default",
);

// Unit specs feed synthetic OSC sequences into xterm and mock the PTY. This
// suite covers the remaining boundary: a real shell sources the shipped
// integration script, runs a command, and reports its new cwd to the model.
test.describe(`shell integration (${SHELL_NAME})`, () => {
  let app;
  let page;
  let temporaryRoot;
  let targetDirectory;

  test.beforeEach(async () => {
    ({ app, page, temporaryRoot } = await openLumine());
    targetDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "terminal-e2e-target-"));
  });

  test.afterEach(async () => {
    try {
      await closeLumine({ app, temporaryRoot });
    } finally {
      if (targetDirectory) {
        await fs.promises.rm(targetDirectory, { recursive: true, force: true });
      }
    }
  });

  test(`tracks cwd after a real cd in a real ${SHELL_NAME} shell`, async () => {
    const terminalElement = await openTerminal(page);
    await waitForShellToSettle(page);
    await terminalElement.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type(`cd '${targetDirectory}'`);
    await page.keyboard.press("Enter");

    try {
      await expect
        .poll(
          async () => {
            const cwd = await page.evaluate(
              (selector) => document.querySelector(selector)?.getModel?.().cwd,
              TERMINAL_ELEMENT_SELECTOR,
            );
            return cwd ? path.normalize(cwd) : cwd;
          },
          { message: "waiting for shell integration to report the new cwd", timeout: 20_000 },
        )
        .toBe(path.normalize(fs.realpathSync(targetDirectory)));
    } catch (error) {
      console.log(`--- terminal contents at failure ---\n${await readTerminalContents(page)}`);
      throw error;
    }
  });
});
