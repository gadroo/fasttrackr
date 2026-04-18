import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { config } from "dotenv";

config({ path: ".env.local" });

import { closeDbPool, getDb } from "../src/lib/db/client";
import { importSpreadsheet } from "../src/lib/import/spreadsheet-import";

async function main() {
  const filepath = resolve(process.cwd(), "Master Client Info Sample Data.csv");
  const buffer = await readFile(filepath);
  const result = await importSpreadsheet({
    db: getDb(),
    filename: "Master Client Info Sample Data.csv",
    fileBuffer: buffer,
  });
  console.log("Seed completed:", result);
  await closeDbPool();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
