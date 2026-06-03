import { BadRequestError } from "../lib/errors.js";

export function parseQq(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9]{5,15}$/u.test(value.trim())) {
    throw new BadRequestError("qq must be a numeric string with 5 to 15 digits");
  }
  return value.trim();
}
