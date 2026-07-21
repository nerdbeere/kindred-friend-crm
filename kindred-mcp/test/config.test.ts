import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("loads valid config and strips trailing slashes from base URL", () => {
    const cfg = loadConfig({
      KINDRED_URL: "https://kindred.example.com///",
      KINDRED_TOKEN: "abc123",
    });
    expect(cfg.baseUrl).toBe("https://kindred.example.com");
    expect(cfg.token).toBe("abc123");
  });

  it("trims whitespace", () => {
    const cfg = loadConfig({
      KINDRED_URL: "  https://k.example.com  ",
      KINDRED_TOKEN: "  tok  ",
    });
    expect(cfg.baseUrl).toBe("https://k.example.com");
    expect(cfg.token).toBe("tok");
  });

  it("throws when KINDRED_URL is missing", () => {
    expect(() => loadConfig({ KINDRED_TOKEN: "x" })).toThrow(/KINDRED_URL/);
  });

  it("throws when KINDRED_TOKEN is missing", () => {
    expect(() =>
      loadConfig({ KINDRED_URL: "https://k.example.com" }),
    ).toThrow(/KINDRED_TOKEN/);
  });

  it("throws when both are missing", () => {
    expect(() => loadConfig({})).toThrow(/KINDRED_URL.*KINDRED_TOKEN/);
  });

  it("throws on invalid URL", () => {
    expect(() =>
      loadConfig({ KINDRED_URL: "not a url", KINDRED_TOKEN: "x" }),
    ).toThrow(/not a valid URL/);
  });
});
