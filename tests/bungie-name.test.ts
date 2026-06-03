import { describe, expect, it } from "vitest";
import { BadRequestError } from "../src/lib/errors.js";
import { parseBungieName } from "../src/destiny/bungie-name.js";

describe("parseBungieName", () => {
  it("parses and normalizes Bungie names", () => {
    expect(parseBungieName("Guardian#7")).toEqual({
      raw: "Guardian#7",
      displayName: "Guardian",
      displayNameCode: 7,
      normalized: "guardian#0007"
    });
  });

  it("rejects missing display code", () => {
    expect(() => parseBungieName("Guardian")).toThrow(BadRequestError);
  });
});
