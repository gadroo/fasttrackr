import { NextRequest } from "next/server";
import { APIConnectionTimeoutError, APIError, RateLimitError } from "openai";

import { fail, ok } from "@/lib/api/response";
import { revalidateReadModelTags } from "@/lib/cache/tags";
import { getDb } from "@/lib/db/client";
import { isTransientDatabaseError } from "@/lib/db/errors";
import { importAudio } from "@/lib/import/audio-import";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_AUDIO_FILE_BYTES = 25 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const householdId = formData.get("householdId");
    if (!(file instanceof Blob)) {
      return fail("Missing audio file.", 400);
    }
    if (!householdId || typeof householdId !== "string") {
      return fail("Missing target household.", 400);
    }
    if (file.size > MAX_AUDIO_FILE_BYTES) {
      return fail("Audio file is too large. Maximum supported size is 25MB.", 413);
    }
    const filename = file instanceof File ? file.name : "upload-audio";
    const arrayBuffer = await file.arrayBuffer();
    const result = await importAudio({
      db: getDb(),
      householdId,
      filename,
      fileBuffer: Buffer.from(arrayBuffer),
      mimeType: file.type,
    });
    revalidateReadModelTags();
    return ok(result);
  } catch (error) {
    if (isTransientDatabaseError(error)) {
      return fail("Database is temporarily unavailable. Please retry in a few seconds.", 503);
    }
    if (error instanceof APIConnectionTimeoutError) {
      return fail("AI provider timed out while processing audio. Please retry with a shorter clip.", 504);
    }
    if (error instanceof RateLimitError) {
      return fail("AI provider rate limit reached. Please retry in a few moments.", 429);
    }
    if (error instanceof APIError) {
      if (error.status === 400 || error.status === 413 || error.status === 422) {
        return fail("Audio content could not be processed. Please upload a smaller or clearer file.", 422, error.message);
      }
      if (error.status && error.status >= 500) {
        return fail("AI provider is temporarily unavailable. Please retry shortly.", 502, error.message);
      }
    }
    return fail("Audio import failed.", 500, error instanceof Error ? error.message : String(error));
  }
}
