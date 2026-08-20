// The require cache hands this spec the same module instance the package
// itself uses, so the module-level subscription state is the real one.
const Logger = require("../lib/log");

describe("Logger", () => {
  beforeEach(() => {
    // Drop whatever observer a previous suite (or the package's activation)
    // left behind, so each spec starts from the uninitialized state.
    Logger.destroy();
  });

  afterEach(() => {
    // Leave a live observer for the other suites, matching activation.
    Logger.destroy();
    Logger.initialize();
  });

  describe("initialize()", () => {
    it("subscribes only once however many times it is called", () => {
      spyOn(lumine.config, "observe").and.callThrough();
      Logger.initialize();
      Logger.initialize();
      expect(lumine.config.observe.calls.count()).toBe(1);
    });

    it("subscribes again after destroy()", () => {
      Logger.initialize();
      Logger.destroy();
      spyOn(lumine.config, "observe").and.callThrough();
      Logger.initialize();
      expect(lumine.config.observe.calls.count()).toBe(1);
    });
  });
});
