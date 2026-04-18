"use client";

import { FileSpreadsheet, Mic, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { useUploadManager } from "@/components/upload-manager";
import type { HouseholdOption } from "@/lib/types";

function fileMatchesAccept(file: File, accept: string[]): boolean {
  const nameLower = file.name.toLowerCase();
  const ext = nameLower.includes(".") ? nameLower.slice(nameLower.lastIndexOf(".")) : "";
  const mime = file.type.toLowerCase();

  return accept.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.startsWith(".")) {
      return ext === p;
    }
    if (p.endsWith("/*")) {
      const base = p.slice(0, -2);
      if (mime.startsWith(`${base}/`)) return true;
      if (!mime && base === "audio") {
        return /\.(mp3|m4a|wav|aac|ogg|flac|webm|opus|aiff?|wma)$/i.test(file.name);
      }
      return false;
    }
    return mime === p;
  });
}

function isFileDrag(e: DragEvent): boolean {
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes("Files");
}

function getDroppedFile(e: DragEvent): File | null {
  const direct = e.dataTransfer?.files?.[0];
  if (direct) return direct;

  const items = e.dataTransfer?.items;
  if (!items) return null;

  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) return file;
  }

  return null;
}

const SPREADSHEET_ACCEPT = [".csv", ".xlsx", ".xls"] as const;
const AUDIO_ACCEPT = ["audio/*"] as const;

function useNativeDropZone(accept: readonly string[], onFile: (f: File) => void) {
  const [dragOver, setDragOver] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef(0);
  const acceptRef = useRef<readonly string[]>(accept);
  const onFileRef = useRef(onFile);

  useEffect(() => {
    acceptRef.current = accept;
  }, [accept]);

  useEffect(() => {
    onFileRef.current = onFile;
  }, [onFile]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const preventWindowFileDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
    };

    const handleEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current += 1;
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    };

    const handleOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    };

    const handleLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      const next = e.relatedTarget as Node | null;
      if (next && el.contains(next)) return;
      if (dragDepthRef.current === 0) setDragOver(false);
    };

    const handleDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      dragDepthRef.current = 0;
      setDragOver(false);
      const file = getDroppedFile(e);
      if (!file) return;
      if (fileMatchesAccept(file, [...acceptRef.current])) {
        onFileRef.current(file);
      }
    };

    el.addEventListener("dragenter", handleEnter, true);
    el.addEventListener("dragover", handleOver, true);
    el.addEventListener("dragleave", handleLeave, true);
    el.addEventListener("drop", handleDrop, true);

    window.addEventListener("dragover", preventWindowFileDrop);
    window.addEventListener("drop", preventWindowFileDrop);

    return () => {
      el.removeEventListener("dragenter", handleEnter, true);
      el.removeEventListener("dragover", handleOver, true);
      el.removeEventListener("dragleave", handleLeave, true);
      el.removeEventListener("drop", handleDrop, true);

      window.removeEventListener("dragover", preventWindowFileDrop);
      window.removeEventListener("drop", preventWindowFileDrop);
    };
  }, []);

  return [dragOver, rootRef] as const;
}

type DropZoneTuple = readonly [boolean, RefObject<HTMLDivElement | null>];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadPanels({ households }: { households: HouseholdOption[] }) {
  const [spreadsheetFile, setSpreadsheetFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [targetHouseholdId, setTargetHouseholdId] = useState<string>(households[0]?.id ?? "");
  const [validationMessage, setValidationMessage] = useState<string>("");
  const spreadsheetInputId = useId();
  const audioInputId = useId();
  const spreadsheetInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const {
    spreadsheetBusy,
    spreadsheetStep,
    audioBusy,
    audioStep,
    startSpreadsheetUpload,
    startAudioUpload,
  } = useUploadManager();

  const [spreadDragOver, spreadZoneRef]: DropZoneTuple = useNativeDropZone(
    SPREADSHEET_ACCEPT,
    setSpreadsheetFile,
  );
  const [audioDragOver, audioZoneRef]: DropZoneTuple = useNativeDropZone(AUDIO_ACCEPT, setAudioFile);

  const uploadSpreadsheet = async () => {
    if (!spreadsheetFile) {
      setValidationMessage("Choose a spreadsheet file first.");
      return;
    }

    setValidationMessage("");
    const result = await startSpreadsheetUpload(spreadsheetFile);
    if (result.ok) {
      setSpreadsheetFile(null);
    } else {
      setValidationMessage(result.error);
    }
  };

  const clearSpreadsheetFile = () => {
    setSpreadsheetFile(null);
    if (spreadsheetInputRef.current) spreadsheetInputRef.current.value = "";
  };

  const clearAudioFile = () => {
    setAudioFile(null);
    if (audioInputRef.current) audioInputRef.current.value = "";
  };

  const uploadAudio = async () => {
    if (!audioFile) {
      setValidationMessage("Choose an audio file first.");
      return;
    }
    if (!targetHouseholdId) {
      setValidationMessage("Select a target household.");
      return;
    }

    setValidationMessage("");
    const result = await startAudioUpload(audioFile, targetHouseholdId);
    if (result.ok) {
      setAudioFile(null);
    } else {
      setValidationMessage(result.error);
    }
  };

  const progressText = [spreadsheetStep, audioStep].filter(Boolean).join(" · ");
  const statusText = progressText || validationMessage;
  const statusIsError = Boolean(validationMessage) && !progressText;

  return (
    <section className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
        <article className="flex h-full min-h-0 flex-col rounded-2xl border border-border-primary bg-bg-surface p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border-primary bg-bg-muted text-text-secondary"
              aria-hidden
            >
              <FileSpreadsheet className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-text-primary">
                Spreadsheet import
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                Creates or updates household records from a file. Multi-sheet workbooks and normalized column headers are supported.
              </p>
              <p className="mt-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">
                Runs in background while you browse
              </p>
            </div>
          </div>

          <div
            ref={spreadZoneRef}
            className={`relative mt-5 flex min-h-[12rem] flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
              spreadDragOver
                ? "border-accent bg-accent-subtle"
                : "border-border-primary bg-bg-muted/80"
            }`}
          >
            {spreadsheetFile ? (
              <button
                type="button"
                disabled={spreadsheetBusy}
                onClick={clearSpreadsheetFile}
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-primary bg-bg-surface text-text-secondary shadow-sm transition hover:bg-bg-muted hover:text-text-primary disabled:pointer-events-none disabled:opacity-50"
                aria-label="Remove selected spreadsheet file"
              >
                <X className="h-4 w-4" strokeWidth={2} aria-hidden />
              </button>
            ) : null}
            <p className="text-sm font-medium text-text-primary">
              {spreadsheetFile ? spreadsheetFile.name : "Drop a file here"}
            </p>
            {spreadsheetFile ? (
              <p className="mt-1 text-xs text-text-tertiary">{formatFileSize(spreadsheetFile.size)}</p>
            ) : (
              <p className="mt-1 text-xs text-text-tertiary">CSV, XLSX, or XLS</p>
            )}
            <button
              type="button"
              className="mt-4 inline-flex cursor-pointer items-center justify-center rounded-lg border border-border-primary bg-bg-surface px-4 py-2 text-sm font-medium text-text-primary shadow-sm transition hover:bg-bg-muted"
              onClick={() => spreadsheetInputRef.current?.click()}
            >
              Browse files
            </button>
          </div>
          <input
            id={spreadsheetInputId}
            ref={spreadsheetInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose spreadsheet file"
            onChange={(e) => setSpreadsheetFile(e.target.files?.[0] ?? null)}
          />

          <Button
            type="button"
            onClick={uploadSpreadsheet}
            className="mt-6 w-full shrink-0"
            disabled={spreadsheetBusy}
          >
            {spreadsheetBusy ? spreadsheetStep || "Importing…" : "Import spreadsheet"}
          </Button>
        </article>

        <article className="flex h-full min-h-0 flex-col rounded-2xl border border-border-primary bg-bg-surface p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border-primary bg-bg-muted text-text-secondary"
              aria-hidden
            >
              <Mic className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-text-primary">
                Call audio enrichment
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                Attaches to one household you select. Transcription and fact extraction run after upload.
              </p>
              <p className="mt-2 text-xs font-medium uppercase tracking-wide text-text-tertiary">
                Runs in background while you browse
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <label htmlFor="upload-household" className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
              Household
            </label>
            <select
              id="upload-household"
              value={targetHouseholdId}
              onChange={(e) => setTargetHouseholdId(e.target.value)}
              className="block w-full rounded-lg border border-border-primary bg-bg-surface px-3 py-2.5 text-sm text-text-primary shadow-sm outline-none ring-accent transition focus:ring-2"
            >
              {households.length ? (
                households.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))
              ) : (
                <option value="">No households yet — import a spreadsheet first</option>
              )}
            </select>
          </div>

          <div
            ref={audioZoneRef}
            className={`relative mt-4 flex min-h-[12rem] flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
              audioDragOver
                ? "border-accent bg-accent-subtle"
                : "border-border-primary bg-bg-muted/80"
            }`}
          >
            {audioFile ? (
              <button
                type="button"
                disabled={audioBusy}
                onClick={clearAudioFile}
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-primary bg-bg-surface text-text-secondary shadow-sm transition hover:bg-bg-muted hover:text-text-primary disabled:pointer-events-none disabled:opacity-50"
                aria-label="Remove selected audio file"
              >
                <X className="h-4 w-4" strokeWidth={2} aria-hidden />
              </button>
            ) : null}
            <p className="text-sm font-medium text-text-primary">
              {audioFile ? audioFile.name : "Drop audio here"}
            </p>
            {audioFile ? (
              <p className="mt-1 text-xs text-text-tertiary">{formatFileSize(audioFile.size)}</p>
            ) : (
              <p className="mt-1 text-xs text-text-tertiary">Common formats: MP3, M4A, WAV</p>
            )}
            <button
              type="button"
              className="mt-4 inline-flex cursor-pointer items-center justify-center rounded-lg border border-border-primary bg-bg-surface px-4 py-2 text-sm font-medium text-text-primary shadow-sm transition hover:bg-bg-muted"
              onClick={() => audioInputRef.current?.click()}
            >
              Browse files
            </button>
          </div>
          <input
            id={audioInputId}
            ref={audioInputRef}
            type="file"
            accept="audio/*"
            className="sr-only"
            tabIndex={-1}
            aria-label="Choose audio file"
            onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
          />

          <Button
            type="button"
            onClick={uploadAudio}
            className="mt-6 w-full shrink-0"
            variant="secondary"
            disabled={audioBusy || !targetHouseholdId}
          >
            {audioBusy ? audioStep || "Processing…" : "Upload and enrich"}
          </Button>
        </article>
      </div>

      {statusText ? (
        <div
          className={`rounded-xl border px-4 py-3 text-center text-sm ${
            statusIsError
              ? "border-error-border bg-error-subtle text-error-text"
              : "border-border-primary bg-bg-surface text-text-secondary shadow-sm"
          }`}
          role="status"
          aria-live="polite"
        >
          {statusText}
        </div>
      ) : null}
    </section>
  );
}
