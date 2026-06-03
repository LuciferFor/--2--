import { describe, expect, it } from "vitest";
import { parseQq } from "../src/bindings/qq.js";
import { BadRequestError } from "../src/lib/errors.js";

describe("QQ validation", () => {
  it("accepts numeric strings with 5 to 15 digits", () => {
    expect(parseQq("12345")).toBe("12345");
    expect(parseQq("123456789012345")).toBe("123456789012345");
  });

  it("rejects invalid QQ values", () => {
    for (const value of ["", "1234", "1234567890123456", "12abc", 123456]) {
      expect(() => parseQq(value)).toThrow(BadRequestError);
    }
  });
});
