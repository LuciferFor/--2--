import { randomBytes } from "node:crypto";
import { hashPassword } from "../src/admin/auth.js";

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run admin:hash -- \"your-password\"");
  process.exit(1);
}

console.log(`ADMIN_PASSWORD_HASH=${hashPassword(password)}`);
console.log(`ADMIN_SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
