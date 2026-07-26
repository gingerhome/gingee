/**
 * Body parser helpers (M1 media type, has-body, oversize path covered in gingee.middleware).
 */
const {
  parseMediaType,
  getContentTypeHeader,
  requestLikelyHasBody,
} = require("../../modules/engine/request_context/body");

describe("request_context/body helpers", () => {
  describe("parseMediaType", () => {
    test("strips charset and other parameters", () => {
      expect(parseMediaType("application/json; charset=utf-8")).toBe(
        "application/json",
      );
      expect(parseMediaType("application/json;charset=UTF-8")).toBe(
        "application/json",
      );
      expect(parseMediaType("APPLICATION/JSON; charset=utf-8")).toBe(
        "application/json",
      );
      expect(
        parseMediaType("application/x-www-form-urlencoded; charset=UTF-8"),
      ).toBe("application/x-www-form-urlencoded");
      expect(
        parseMediaType("multipart/form-data; boundary=----WebKitFormBoundary"),
      ).toBe("multipart/form-data");
    });

    test("handles bare types, empty, and whitespace", () => {
      expect(parseMediaType("text/plain")).toBe("text/plain");
      expect(parseMediaType("")).toBe("");
      expect(parseMediaType(null)).toBe("");
      expect(parseMediaType(undefined)).toBe("");
      expect(parseMediaType("  application/json  ; charset=utf-8")).toBe(
        "application/json",
      );
    });
  });

  describe("getContentTypeHeader", () => {
    test("reads string or first array element", () => {
      expect(
        getContentTypeHeader({
          headers: { "content-type": "application/json" },
        }),
      ).toBe("application/json");
      expect(
        getContentTypeHeader({
          headers: {
            "content-type": ["application/json; charset=utf-8", "text/plain"],
          },
        }),
      ).toBe("application/json; charset=utf-8");
      expect(getContentTypeHeader({ headers: {} })).toBe("");
      expect(getContentTypeHeader(null)).toBe("");
    });
  });

  describe("requestLikelyHasBody", () => {
    test("uses numeric content-length (not string compare)", () => {
      // String compare "9" > "10" is true — regression guard for the old bug class.
      expect(requestLikelyHasBody({ headers: { "content-length": "9" } })).toBe(
        true,
      );
      expect(requestLikelyHasBody({ headers: { "content-length": "0" } })).toBe(
        false,
      );
      expect(
        requestLikelyHasBody({ headers: { "content-length": "10" } }),
      ).toBe(true);
      expect(
        requestLikelyHasBody({ headers: { "transfer-encoding": "chunked" } }),
      ).toBe(true);
      expect(requestLikelyHasBody({ headers: {} })).toBe(false);
    });
  });
});
