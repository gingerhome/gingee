/**
 * Glade HTML escape (XSS defense for app list + packconfig).
 */
const { escapeHtml } = require("../../web/glade/scripts/glade_escape.js");

describe("GladeEscape.escapeHtml", () => {
  test("escapes HTML special characters", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(escapeHtml("a & b")).toBe("a &amp; b");
    expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;");
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  test("handles null/undefined/numbers", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(42)).toBe("42");
  });

  test("payload that would break data-app attribute is neutralized", () => {
    const evil = 'x" onclick="alert(1)';
    const safe = escapeHtml(evil);
    expect(safe).not.toContain('"');
    expect(safe).toBe("x&quot; onclick=&quot;alert(1)");
    // Simulated attribute injection no longer closes the attribute early
    const html = `<a data-app="${safe}">`;
    expect(html).toBe('<a data-app="x&quot; onclick=&quot;alert(1)">');
  });

  test("app name with angle brackets cannot inject tags in cell", () => {
    const name = "<img src=x onerror=alert(1)>";
    expect(`<td>${escapeHtml(name)}</td>`).toBe(
      "<td>&lt;img src=x onerror=alert(1)&gt;</td>",
    );
  });
});
