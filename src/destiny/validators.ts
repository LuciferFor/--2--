import { BadRequestError } from "../lib/errors.js";
import { VALID_MEMBERSHIP_TYPES } from "./constants.js";

export function parseMembershipType(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || !VALID_MEMBERSHIP_TYPES.has(parsed)) {
    throw new BadRequestError("Invalid membershipType");
  }
  return parsed;
}

export function parseId(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[0-9]+$/u.test(value)) {
    throw new BadRequestError(`${name} must be a numeric string`);
  }
  return value;
}

export function parseCount(value: unknown, fallback = 10): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new BadRequestError("count must be an integer between 1 and 100");
  }
  return parsed;
}

export function parsePage(value: unknown, fallback = 0): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000) {
    throw new BadRequestError("page must be a non-negative integer");
  }
  return parsed;
}
