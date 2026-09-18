const fs = require("fs");
const os = require("os");
const path = require("path");
const { expect, _electron: electron } = require("@playwright/test");

const REPO_ROOT = path.resolve(__dirname, "..");
const LUMINE_ROOT = path.resolve(
  process.env.LUMINE_REPOSITORY || path.join(REPO_ROOT, "..", "lumine"),
);
const TERMINAL_ELEMENT_SELECTOR = "terminal-view";

function getElectronPath() {
  if (process.env.LUMINE_EXECUTABLE) return path.resolve(process.env.LUMINE_EXECUTABLE);
  return require(path.join(LUMINE_ROOT, "node_modules", "electron"));
}

async function openLumine() {
  // Keep both the editor state and shell dotfiles isolated from the account
  // running the test. The package link is the same packages-dev setup used
  // while developing Lumine packages locally.
  const temporaryRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "terminal-e2e-"));
  const lumineHome = path.join(temporaryRoot, "lumine-home");
  const shellHome = path.join(temporaryRoot, "shell-home");
  const packagesDev = path.join(lumineHome, "packages-dev");
  await fs.promises.mkdir(path.join(lumineHome, "electronUserData"), { recursive: true });
  await fs.promises.mkdir(packagesDev, { recursive: true });
  await fs.promises.mkdir(shellHome, { recursive: true });
  await fs.promises.symlink(
    REPO_ROOT,
    path.join(packagesDev, "terminal"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const app = await electron.launch({
    executablePath: getElectronPath(),
    args: [
      "--no-sandbox",
      "--enable-logging",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      LUMINE_ROOT,
      "--dev",
      "--clear-window-state",
      REPO_ROOT,
    ],
    cwd: LUMINE_ROOT,
    env: {
      ...process.env,
      HOME: shellHome,
      LUMINE_HOME: lumineHome,
      LUMINE_RESOURCE_PATH: LUMINE_ROOT,
    },
    timeout: 90_000,
  });
  const page = await app.firstWindow();
  if (process.env.TERMINAL_E2E_DEBUG) {
    page.on("console", (message) => console.log(`[lumine:${message.type()}] ${message.text()}`));
  }
  await expect(page.locator("lumine-workspace")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean(window.lumine && lumine.window?.isDevMode())))
    .toBe(true);
  await page.evaluate(() => lumine.window.whenLoaded());
  await page.evaluate(() => lumine.packages.activatePackage("terminal"));
  const shell = process.env.TERMINAL_E2E_SHELL || process.env.SHELL;
  if (shell) {
    await page.evaluate(
      (shellPath) => lumine.config.set("terminal.terminal.shell", shellPath),
      shell,
    );
  }
  if (process.env.TERMINAL_E2E_DEBUG) {
    await page.evaluate(() => lumine.config.set("terminal.advanced.enableDebugLogging", true));
    console.log(
      await page.evaluate(() => ({
        execPath: process.execPath,
        shell: process.env.SHELL,
        comspec: process.env.COMSPEC,
      })),
    );
  }
  await expect
    .poll(() => page.evaluate(() => lumine.packages.isPackageActive("terminal")))
    .toBe(true);

  return { app, page, temporaryRoot };
}

async function closeLumine({ app, temporaryRoot }) {
  try {
    if (app) await app.close();
  } finally {
    if (temporaryRoot) {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}

async function openTerminal(page) {
  await page.evaluate(() => {
    const workspace = document.querySelector("lumine-workspace");
    lumine.commands.dispatch(workspace, "terminal:open-center");
  });
  const element = page.locator(TERMINAL_ELEMENT_SELECTOR).first();
  await expect(element).toBeVisible();
  await page.evaluate(
    (selector) => document.querySelector(selector)?.ready?.(),
    TERMINAL_ELEMENT_SELECTOR,
  );
  return element;
}

async function readTerminalContents(page) {
  return page.evaluate((selector) => {
    const terminal = document.querySelector(selector)?.terminal;
    if (!terminal) return null;
    const lines = [];
    for (let index = 0; index < terminal.buffer.active.length; index++) {
      lines.push(terminal.buffer.active.getLine(index)?.translateToString(true));
    }
    return lines.join("\n");
  }, TERMINAL_ELEMENT_SELECTOR);
}

async function waitForShellToSettle(
  page,
  { settleMs = 300, pollMs = 100, timeoutMs = 20_000 } = {},
) {
  // A live PTY is not necessarily ready for input: the shell may still be
  // sourcing profiles and the injected integration script. Wait for the
  // rendered prompt to stop changing before sending the test command.
  const deadline = Date.now() + timeoutMs;
  let previous = null;
  let stableSince = null;
  while (Date.now() < deadline) {
    const current = await readTerminalContents(page);
    if (current?.trim()) {
      if (current === previous) {
        stableSince ??= Date.now();
        if (Date.now() - stableSince >= settleMs) return current;
      } else {
        stableSince = null;
      }
    }
    previous = current;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for the shell prompt; last contents: ${JSON.stringify(previous)}`,
  );
}

module.exports = {
  closeLumine,
  openLumine,
  openTerminal,
  readTerminalContents,
  waitForShellToSettle,
  TERMINAL_ELEMENT_SELECTOR,
};
