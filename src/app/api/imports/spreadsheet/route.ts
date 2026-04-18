import { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/response";
import { revalidateReadModelTags } from "@/lib/cache/tags";
import { getDb } from "@/lib/db/client";
import { isTransientDatabaseError } from "@/lib/db/errors";
import { importSpreadsheet } from "@/lib/import/spreadsheet-import";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return fail("Missing spreadsheet file.", 400);
    }
    const arrayBuffer = await file.arrayBuffer();
    const result = await importSpreadsheet({
      db: getDb(),
      filename: file.name,
      fileBuffer: Buffer.from(arrayBuffer),
    });
    revalidateReadModelTags();
    return ok(result);
  } catch (error) {
    if (isTransientDatabaseError(error)) {
      return fail("Database is temporarily unavailable. Please retry in a few seconds.", 503);
    }
    return fail("Spreadsheet import failed.", 500, error instanceof Error ? error.message : String(error));
  }
}
