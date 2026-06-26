import { describe, expect, it } from "vitest";
import { compareVersions, isNewerVersion } from "../src/ota/version.js";

describe("OTA version comparison", () => {
  it("compares semantic versions with optional v prefix", () => {
    expect(compareVersions("v1.2.10", "1.2.9")).toBe(1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0", "1.3.0")).toBe(-1);
  });

  it("detects newer releases", () => {
    expect(isNewerVersion("v0.2.0", "0.1.9")).toBe(true);
    expect(isNewerVersion("v0.2.0", "0.2.0")).toBe(false);
  });
});
