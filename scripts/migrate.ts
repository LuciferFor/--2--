import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://destiny:destiny@localhost:5432/destiny";
const migrationsDir = path.resolve("migrations");
const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    await pool.query(sql);
    console.log(`Applied ${file}`);
  }
} finally {
  await pool.end();
}
