import { fail, ok } from "@/lib/api/response";
import { revalidateReadModelTags } from "@/lib/cache/tags";
import { getDb } from "@/lib/db/client";
import { dismissChangeProposal } from "@/lib/db/repository";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await dismissChangeProposal(getDb(), id);
    revalidateReadModelTags();
    return ok({ success: true });
  } catch (error) {
    return fail("Failed to dismiss change.", 500, error instanceof Error ? error.message : String(error));
  }
}
