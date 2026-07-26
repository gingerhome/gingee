/**
 * Glade install vs upgrade modal mode wiring (source-code review C3).
 */
const {
  resolveInstallModalMode,
  lifecycleApiUrl,
  getInstallLifecycleMode,
} = require("../../web/glade/scripts/install_modal_mode.js");

function fakeEl(classNames, dataset, attrs) {
  const classes = new Set(classNames || []);
  return {
    classList: {
      contains(c) {
        return classes.has(c);
      },
    },
    dataset: dataset || {},
    getAttribute(name) {
      return (attrs && attrs[name]) || null;
    },
  };
}

describe("GladeInstallModalMode", () => {
  test("Install button (no upgrade class) → install", () => {
    const trigger = fakeEl(["btn", "btn-success"], {});
    expect(resolveInstallModalMode(trigger)).toEqual({
      mode: "install",
      appName: null,
    });
  });

  test("action-upgrade with data-app → upgrade (dropdown path)", () => {
    const trigger = fakeEl(["dropdown-item", "action-upgrade"], {
      app: "myapp",
    });
    expect(resolveInstallModalMode(trigger)).toEqual({
      mode: "upgrade",
      appName: "myapp",
    });
  });

  test("legacy btn-upgrade still works", () => {
    const trigger = fakeEl(["btn-upgrade"], { app: "legacyapp" });
    expect(resolveInstallModalMode(trigger)).toEqual({
      mode: "upgrade",
      appName: "legacyapp",
    });
  });

  test("data-mode=upgrade with app name", () => {
    const trigger = fakeEl([], { app: "x" }, { "data-mode": "upgrade" });
    expect(resolveInstallModalMode(trigger)).toEqual({
      mode: "upgrade",
      appName: "x",
    });
  });

  test("action-upgrade without app name falls back to install", () => {
    expect(resolveInstallModalMode(fakeEl(["action-upgrade"], {}))).toEqual({
      mode: "install",
      appName: null,
    });
  });

  test("null/undefined trigger → install", () => {
    expect(resolveInstallModalMode(null).mode).toBe("install");
    expect(resolveInstallModalMode(undefined).mode).toBe("install");
  });

  test("lifecycleApiUrl maps mode to correct endpoints", () => {
    expect(lifecycleApiUrl("upgrade")).toBe("/glade/api/upgrade");
    expect(lifecycleApiUrl("install")).toBe("/glade/api/install");
    expect(lifecycleApiUrl(null)).toBe("/glade/api/install");
  });

  test("getInstallLifecycleMode reads data-mode only (not wizard step value)", () => {
    expect(
      getInstallLifecycleMode({
        dataset: { mode: "upgrade" },
        value: "wizard-confirm",
      }),
    ).toBe("upgrade");
    expect(
      getInstallLifecycleMode({
        dataset: { mode: "install" },
        value: "wizard-confirm",
      }),
    ).toBe("install");
    // Missing dataset.mode must not treat wizard step as lifecycle
    expect(getInstallLifecycleMode({ value: "upgrade" })).toBe("install");
  });
});
