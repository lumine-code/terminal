const path = require("node:path");

describe("Terminal service payload ownership", () => {
  let main, state, hub, leases, consumers;
  const definitions = [
    ["open-external", "1.0.0", "consumeOpenExternal", "getOpenExternal"],
    ["mcp.bridge", "1.1.0", "consumeMcpBridge", "getMcpBridge"],
  ];
  beforeEach(async () => {
    for (const name of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, name).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    localStorage.setItem("terminal.autoShellSet", "true");
    const pack = await lumine.packages.activatePackage("terminal");
    main = pack.mainModule;
    state = require(path.join(pack.path, "lib", "runtime-state"));
    hub = new lumine.packages.serviceHub.constructor();
    leases = [];
    consumers = [];
  });
  afterEach(async () => {
    for (const lease of leases) lease.dispose();
    for (const consumer of consumers) consumer.dispose();
    await lumine.packages.deactivatePackage("terminal");
  });
  for (const [service, version, method, getter] of definitions) {
    it(`preserves shared ${service} payload until the last actual Hub edge`, () => {
      const first = hub.consume(service, `^${version}`, (payload) => main[method](payload));
      consumers.push(first);
      const payload = {};
      leases.push(hub.provide(service, version, payload));
      consumers.push(hub.consume(service, `^${version}`, (value) => main[method](value)));
      first.dispose();
      expect(state[getter]()).toBe(payload);
    });
    it(`restores the latest surviving ${service} edge in actual A-B-A order`, () => {
      consumers.push(hub.consume(service, `^${version}`, (payload) => main[method](payload)));
      const a = {},
        b = {};
      leases.push(hub.provide(service, version, a), hub.provide(service, version, b));
      const newest = hub.provide(service, version, a);
      leases.push(newest);
      newest.dispose();
      expect(state[getter]()).toBe(b);
    });
    it(`retires a manual ${service} lease through the actual Package lifetime`, async () => {
      const payload = {};
      const old = main[method](payload);
      await lumine.packages.deactivatePackage("terminal");
      const pack = await lumine.packages.activatePackage("terminal");
      main = pack.mainModule;
      state = require(path.join(pack.path, "lib", "runtime-state"));
      leases.push(main[method](payload));
      old.dispose();
      expect(state[getter]()).toBe(payload);
    });
  }
  it("declines a retained actual terminal facade after Package retirement", async () => {
    const facade = main.provideTerminal();
    await lumine.packages.deactivatePackage("terminal");
    const run = spyOn(main, "runCommands").and.resolveTo();
    const open = spyOn(main, "openTerminal").and.resolveTo();
    await facade.run("owned-command-never-spawned");
    await facade.open();
    expect(run).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it("keeps current facade delegation available", async () => {
    const run = spyOn(main, "runCommands").and.resolveTo();
    const facade = main.provideTerminal();
    await facade.run("owned-command-never-spawned");
    expect(run).toHaveBeenCalledWith("owned-command-never-spawned");
  });
});
