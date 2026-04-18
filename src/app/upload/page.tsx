import { UploadPanels } from "@/components/upload-panels";
import { UploadManagerProvider } from "@/components/upload-manager";
import { getCachedHouseholdOptions } from "@/lib/cache/read-models";
import type { HouseholdOption } from "@/lib/types";

export default async function UploadPage() {
  let households: HouseholdOption[] = [];
  try {
    households = await getCachedHouseholdOptions();
  } catch {
    households = [];
  }

  return (
    <UploadManagerProvider>
      <div className="mx-auto w-full max-w-5xl space-y-6 sm:space-y-8">
        <header className="text-left sm:text-center">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-text-tertiary">Ingestion</p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-text-primary sm:text-3xl">
            Import data
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-7 text-text-tertiary sm:mx-auto sm:mt-4 [text-wrap:pretty]">
            Use the left card for spreadsheet household imports. Use the right card to attach a call recording to an existing household. Uploads run in the background, so you can keep working and watch for completion notifications.
          </p>
        </header>
        <UploadPanels households={households} />
      </div>
    </UploadManagerProvider>
  );
}
