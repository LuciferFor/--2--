import { BadRequestError } from "../lib/errors.js";

export interface ParsedBungieName {
  raw: string;
  displayName: string;
  displayNameCode: number;
  normalized: string;
}

export function parseBungieName(input: unknown): ParsedBungieName {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new BadRequestError("bungieName is required");
  }

  const raw = input.trim();
  const match = raw.match(/^(.+)#([0-9]{1,4})$/u);
  if (!match) {
    throw new BadRequestError("bungieName must use the Name#1234 format");
  }

  const displayName = match[1]?.trim();
  const code = Number(match[2]);
  if (!displayName || !Number.isInteger(code) || code < 0 || code > 9999) {
    throw new BadRequestError("Invalid Bungie display name or code");
  }

  return {
    raw,
    displayName,
    displayNameCode: code,
    normalized: `${displayName}#${String(code).padStart(4, "0")}`.toLowerCase()
  };
}
