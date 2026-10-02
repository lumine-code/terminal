const fs = require("node:fs/promises");
const path = require("path");
const { getShellIntegrationInjection } = require("../lib/shell-integration");
const utils = require("../lib/utils");

const SCRIPT_ROOT = path.resolve(__dirname, "..", "shell-integration");
const createdZdotdirs = new Set();

describe("getShellIntegrationInjection", () => {
  beforeEach(() => {
    lumine.config.set("terminal.shellIntegration.enabled", true);
  });

  afterAll(async () => {
    for (const directory of createdZdotdirs)
      await fs.rm(directory, { recursive: true, force: true });
  });

  it("declines when disabled or when the shell is unsupported", async () => {
    lumine.config.set("terminal.shellIntegration.enabled", false);
    expect(await getShellIntegrationInjection("/bin/bash", [], {})).toEqual({
      enabled: false,
      reason: "Disabled in settings",
    });
    lumine.config.set("terminal.shellIntegration.enabled", true);
    expect(await getShellIntegrationInjection("/bin/sh", [], {})).toEqual({
      enabled: false,
      reason: "Unsupported shell: sh",
    });
  });

  it("declines on Windows builds too old for reliable integration", async () => {
    spyOn(utils, "isWindows").and.returnValue(true);
    spyOn(utils, "windowsBuildNumber").and.returnValue(17000);
    expect(await getShellIntegrationInjection("bash.exe", [], {})).toEqual({
      enabled: false,
      reason: "Windows build too old",
    });
  });

  it("injects bash and preserves login intent", async () => {
    const plain = await getShellIntegrationInjection("/usr/bin/bash", [], {});
    expect(plain.enabled).toBe(true);
    expect(plain.injection.args).toEqual([
      "--init-file",
      path.join(SCRIPT_ROOT, "shell-integration-bash.sh"),
    ]);
    expect(plain.injection.env.LUMINE_TERMINAL_INJECTION).toBe("1");
    expect(plain.injection.env.LUMINE_TERMINAL_NONCE).toMatch(/^[0-9a-f-]{36}$/i);

    const login = await getShellIntegrationInjection("bash", ["-l"], {});
    expect(login.injection.env.LUMINE_TERMINAL_SHELL_LOGIN).toBe("1");
    expect(login.injection.args).not.toContain("-l");
  });

  it("injects fish and rejects custom shell arguments", async () => {
    const result = await getShellIntegrationInjection("fish", ["-l"], {});
    expect(result.injection.args).toEqual([
      "-l",
      "--init-command",
      `source "${path.join(SCRIPT_ROOT, "shell-integration.fish")}"`,
    ]);
    expect(await getShellIntegrationInjection("fish", ["-c", "echo hi"], {})).toEqual({
      enabled: false,
      reason: "Unsupported arguments",
    });
  });

  it("injects PowerShell without replacing unsupported arguments", async () => {
    const result = await getShellIntegrationInjection("pwsh", [], {});
    expect(result.enabled).toBe(true);
    expect(result.injection.args).toContain("-noexit");
    expect(result.injection.args.join(" ")).toContain("shell-integration.ps1");
    expect(await getShellIntegrationInjection("pwsh", ["-File", "profile.ps1"], {})).toEqual({
      enabled: false,
      reason: "Unsupported arguments",
    });
  });

  it("prepares one private, content-addressed ZDOTDIR and preserves the user's one", async () => {
    const [first, second] = await Promise.all([
      getShellIntegrationInjection("zsh", [], { ZDOTDIR: "/user/dotfiles" }),
      getShellIntegrationInjection("zsh", [], { ZDOTDIR: "/other" }),
    ]);
    expect(first.enabled).toBe(true);
    expect(first.injection.env.ZDOTDIR).toBe(second.injection.env.ZDOTDIR);
    expect(path.basename(first.injection.env.ZDOTDIR)).toMatch(
      new RegExp(`-lumine-zsh-[0-9a-f]{12}-${process.pid}$`),
    );
    expect(first.injection.env.USER_ZDOTDIR).toBe("/user/dotfiles");
    expect(second.injection.env.USER_ZDOTDIR).toBe("/other");
    createdZdotdirs.add(first.injection.env.ZDOTDIR);
    for (const [sourceName, destinationName] of [
      ["shell-integration-rc.zsh", ".zshrc"],
      ["shell-integration-profile.zsh", ".zprofile"],
      ["shell-integration-env.zsh", ".zshenv"],
      ["shell-integration-login.zsh", ".zlogin"],
    ]) {
      const source = path.join(SCRIPT_ROOT, sourceName);
      const destination = path.join(first.injection.env.ZDOTDIR, destinationName);
      expect(await fs.readFile(destination, "utf8")).toBe(await fs.readFile(source, "utf8"));
      if (process.platform !== "win32") {
        expect((await fs.stat(destination)).mode & 0o777).toBe(
          (await fs.stat(source)).mode & 0o777,
        );
      }
    }
    if (process.platform !== "win32") {
      expect((await fs.stat(first.injection.env.ZDOTDIR)).mode & 0o777).toBe(0o700);
    }
  });
});
