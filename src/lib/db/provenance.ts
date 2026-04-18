import type { DbClient } from "@/lib/db/client";
import { fieldProvenance } from "@/lib/db/schema";

export type ProvenanceInput = {
  targetTable: "households" | "members" | "accounts";
  targetId: string;
  fieldName: string;
  sourceType: "spreadsheet" | "audio" | "user_edit";
  sourceArtifactId?: string | null;
  importJobId?: string | null;
};

export async function upsertProvenance(db: DbClient, input: ProvenanceInput) {
  await db
    .insert(fieldProvenance)
    .values({
      ...input,
      sourceArtifactId: input.sourceArtifactId ?? null,
      importJobId: input.importJobId ?? null,
    })
    .onConflictDoUpdate({
      target: [fieldProvenance.targetTable, fieldProvenance.targetId, fieldProvenance.fieldName],
      set: {
        sourceType: input.sourceType,
        sourceArtifactId: input.sourceArtifactId ?? null,
        importJobId: input.importJobId ?? null,
        setAt: new Date(),
      },
    });
}
