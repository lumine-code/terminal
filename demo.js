// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-javascript"],
  viewport: { width: 1100, height: 730 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("terminal-sample/signal.js");
    await lumine.project.setPaths([fixture("terminal-sample")]);
    lumine.config.set(
      "terminal.terminal.shell",
      process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/sh",
    );
    lumine.config.set(
      "terminal.terminal.args",
      process.platform === "win32" ? ["-NoLogo", "-NoProfile", "-NoExit"] : [],
    );
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Execute the current script in an integrated terminal.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          const p = lumine.packages.getActivePackage("terminal").mainModule;
          state.terminal = await p.open(
            p.generateUri({ cwd: require("path").dirname(state.editor.getPath()) }),
            { location: "bottom" },
          );
          await state.terminal.ready();
          lumine.workspace.getBottomDock().setState({ size: 300 });
          lumine.workspace.getBottomDock().show();
          await new Promise((resolve) => setTimeout(resolve, 2500));
        }
        {
          state.terminal.run("node signal.js");
        }
      },
      ready(context) {
        const { lumine, state } = context;
        return Boolean(
          (() => {
            const t = state.terminal.element?.terminal;
            return (
              t &&
              Array.from({ length: t.buffer.active.length }, (_, i) =>
                t.buffer.active.getLine(i)?.translateToString(),
              )
                .join("\n")
                .includes("Mean amplitude: 0.42") &&
              lumine.workspace.getBottomDock().isVisible()
            );
          })(),
        );
      },
    },
  ],
  async cleanup(context) {
    const { lumine } = context;
    lumine.config.unset("terminal.terminal.shell");
    lumine.config.unset("terminal.terminal.args");
  },
};
