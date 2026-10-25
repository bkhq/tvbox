import type { Route } from "./router";
import { describe, expect, test } from "bun:test";
import { normalizeBasePath, routeRequest } from "./router";

describe("normalizeBasePath", () => {
  test("matches the app's own normalisation", () => {
    expect(normalizeBasePath("/mg")).toBe("/mg");
    expect(normalizeBasePath("mg/")).toBe("/mg");
    expect(normalizeBasePath("")).toBe("");
    expect(normalizeBasePath(undefined)).toBe("");
  });
});

describe("routeRequest", () => {
  const cases: [string, Route][] = [
    ["/", "landing"],
    ["/s/abc/api.json", "subscription"],
    ["/u/stable/mobile-arm64_v8a.json", "updates"],
    ["/dns-query", "doh"],
    ["/dns-query/x", "missing"],
    ["/mg/api/health", "app"],
    ["/mg/api", "app"],
    ["/mg", "redirect"],
    ["/mg/", "console"],
    ["/mg/admin/devices", "console"],
    ["/mg/assets/index-abc.js", "console"],
    ["/api/raw/tvbox/enroll", "enroll"],
    ["/api/raw/tvbox/enroll/x", "missing"],
    ["/api/raw/releases", "missing"],
    ["/api/health", "missing"],
    ["/admin", "missing"],
    ["/mgx", "missing"],
  ];
  for (const [path, route] of cases) {
    test(`${path} → ${route}`, () => {
      expect(routeRequest(path, "/mg")).toBe(route);
    });
  }

  test("/link is the phone control entry, under any base path", () => {
    expect(routeRequest("/link", "/mg")).toBe("control");
    expect(routeRequest("/link", "")).toBe("control");
  });

  test("without a base path the console owns everything but the public routes", () => {
    expect(routeRequest("/", "")).toBe("landing");
    expect(routeRequest("/api/health", "")).toBe("app");
    expect(routeRequest("/admin", "")).toBe("console");
  });
});
