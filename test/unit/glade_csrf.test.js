/**
 * Glade CSRF + Origin helpers (H9).
 */
const path = require("path");
const csrf = require("../../web/glade/box/csrf.js");

describe("glade csrf.js", () => {
  const cryptoStub = {
    generateSecureRandomString: (n) => "a".repeat(n || 32),
  };

  test("isUnsafeMethod flags mutating verbs", () => {
    expect(csrf.isUnsafeMethod("GET")).toBe(false);
    expect(csrf.isUnsafeMethod("HEAD")).toBe(false);
    expect(csrf.isUnsafeMethod("OPTIONS")).toBe(false);
    expect(csrf.isUnsafeMethod("POST")).toBe(true);
    expect(csrf.isUnsafeMethod("DELETE")).toBe(true);
    expect(csrf.isUnsafeMethod("PUT")).toBe(true);
    expect(csrf.isUnsafeMethod("PATCH")).toBe(true);
  });

  test("createCsrfToken uses crypto helper", () => {
    const t = csrf.createCsrfToken(cryptoStub);
    expect(t).toHaveLength(32);
  });

  test("setCsrfCookie is not HttpOnly and uses Path=/glade", () => {
    const v = csrf.setCsrfCookie("tok123", { protocol: "http", headers: {} });
    expect(v).toContain("tok123");
    expect(v).toContain("Path=/glade");
    expect(v).toContain("SameSite=Strict");
    expect(v).not.toMatch(/HttpOnly/i);
    expect(v).not.toMatch(/Secure/i);

    const secure = csrf.setCsrfCookie("tok123", {
      protocol: "https",
      headers: {},
    });
    expect(secure).toContain("Secure");
  });

  test("validateCsrf requires header/body token matching session", () => {
    const session = { csrfToken: "secret-token-value-32chars!!" };

    expect(
      csrf.validateCsrf({ method: "POST", headers: {}, cookies: {} }, session)
        .ok,
    ).toBe(false);
    expect(
      csrf.validateCsrf(
        {
          method: "POST",
          headers: { "x-csrf-token": "wrong" },
          cookies: {},
        },
        session,
      ).reason,
    ).toBe("CSRF_MISMATCH");

    // Cookie alone is not enough (sibling app can send cookie credentials but not read token)
    expect(
      csrf.validateCsrf(
        {
          method: "POST",
          headers: {},
          cookies: { glade_csrf: session.csrfToken },
        },
        session,
      ).reason,
    ).toBe("CSRF_TOKEN_REQUIRED");

    expect(
      csrf.validateCsrf(
        {
          method: "POST",
          headers: { "x-csrf-token": session.csrfToken },
          cookies: { glade_csrf: session.csrfToken },
        },
        session,
      ).ok,
    ).toBe(true);

    expect(
      csrf.validateCsrf(
        {
          method: "POST",
          headers: {},
          body: { _csrf: session.csrfToken },
          cookies: {},
        },
        session,
      ).ok,
    ).toBe(true);
  });

  test("validateOrigin allows same host and env allowlist", () => {
    const req = {
      protocol: "https",
      headers: {
        host: "admin.example.com",
        origin: "https://admin.example.com",
      },
    };
    expect(csrf.validateOrigin(req, {}).ok).toBe(true);

    expect(
      csrf.validateOrigin(
        {
          protocol: "https",
          headers: {
            host: "admin.example.com",
            origin: "https://evil.example.com",
          },
        },
        {},
      ).reason,
    ).toBe("ORIGIN_MISMATCH");

    expect(
      csrf.validateOrigin(
        {
          protocol: "https",
          headers: {
            host: "admin.example.com",
            origin: "https://cdn.example.com",
          },
        },
        { GLADE_ALLOWED_ORIGINS: "https://cdn.example.com,https://other.test" },
      ).ok,
    ).toBe(true);
  });

  test("validateOrigin accepts Referer when Origin absent", () => {
    const r = csrf.validateOrigin(
      {
        protocol: "http",
        headers: {
          host: "localhost:7070",
          referer: "http://localhost:7070/glade/index.html",
        },
      },
      {},
    );
    expect(r.ok).toBe(true);
  });

  test("assertMutatingRequestAllowed combines origin + csrf", () => {
    const session = { csrfToken: "session-csrf-token-abcdefgh" };
    const bad = csrf.assertMutatingRequestAllowed(
      {
        method: "POST",
        headers: {
          host: "localhost:7070",
          origin: "http://localhost:7070",
        },
        cookies: {},
      },
      session,
      {},
    );
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe(403);

    const good = csrf.assertMutatingRequestAllowed(
      {
        method: "POST",
        headers: {
          host: "localhost:7070",
          origin: "http://localhost:7070",
          "x-csrf-token": session.csrfToken,
        },
        cookies: { glade_csrf: session.csrfToken },
      },
      session,
      {},
    );
    expect(good.ok).toBe(true);

    // Safe methods skip
    expect(
      csrf.assertMutatingRequestAllowed(
        { method: "GET", headers: {}, cookies: {} },
        session,
        {},
      ).ok,
    ).toBe(true);
  });

  test("client glade_csrf.js exposes GladeCsrf helpers", () => {
    // Load as script-like: evaluate in vm with document mock
    const fs = require("fs");
    const vm = require("vm");
    const src = fs.readFileSync(
      path.join(__dirname, "../../web/glade/scripts/glade_csrf.js"),
      "utf8",
    );
    const sandbox = {
      window: {},
      document: {
        cookie: "sessionId=abc; glade_csrf=my-csrf-token; other=1",
      },
      fetch: jest.fn(() => Promise.resolve({ ok: true })),
    };
    sandbox.globalThis = sandbox;
    vm.runInNewContext(src, sandbox);
    const G = sandbox.window.GladeCsrf;
    expect(G.getToken()).toBe("my-csrf-token");
    expect(G.headers()["X-CSRF-Token"]).toBe("my-csrf-token");
    expect(G.isUnsafeMethod("POST")).toBe(true);

    G.fetch("/glade/api/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(sandbox.fetch).toHaveBeenCalled();
    const opts = sandbox.fetch.mock.calls[0][1];
    expect(opts.credentials).toBe("include");
    expect(opts.headers["X-CSRF-Token"]).toBe("my-csrf-token");
  });
});
