import { describe, it, expect } from "vitest";
import { generateName } from "./names";

describe("generateName", () => {
  it("returns a string in adjective-noun format", () => {
    const name = generateName();
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("generates different names (probabilistic)", () => {
    const names = new Set(Array.from({ length: 50 }, () => generateName()));
    // With 3132 combinations, 50 draws should produce at least a few unique
    expect(names.size).toBeGreaterThan(1);
  });
});
