"use client";

import Link from "next/link";
import { CheckCircle2, LoaderCircle, X, XCircle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type UploadResult = { ok: true } | { ok: false; error: string };

type UploadNotification = {
  id: string;
  tone: "success" | "error";
  title: string;
  detail: string;
  href?: string;
  actionLabel?: string;
};

type UploadManagerContextValue = {
  spreadsheetBusy: boolean;
  spreadsheetStep: string;
  audioBusy: boolean;
  audioStep: string;
  startSpreadsheetUpload: (file: File) => Promise<UploadResult>;
  startAudioUpload: (file: File, householdId: string) => Promise<UploadResult>;
};

const UploadManagerContext = createContext<UploadManagerContextValue | null>(null);

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type UploadProgress = {
  busy: boolean;
  step: string;
  fileName: string;
};

type DismissedProgress = {
  spreadsheet: boolean;
  audio: boolean;
};

function initialProgress(): UploadProgress {
  return { busy: false, step: "", fileName: "" };
}

export function UploadManagerProvider({ children }: { children: ReactNode }) {
  const [spreadsheetProgress, setSpreadsheetProgress] = useState<UploadProgress>(initialProgress);
  const [audioProgress, setAudioProgress] = useState<UploadProgress>(initialProgress);
  const [dismissedProgress, setDismissedProgress] = useState<DismissedProgress>({
    spreadsheet: false,
    audio: false,
  });
  const [notifications, setNotifications] = useState<UploadNotification[]>([]);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const pushNotification = useCallback((notification: Omit<UploadNotification, "id">) => {
    setNotifications((prev) => [{ ...notification, id: makeId() }, ...prev].slice(0, 4));
  }, []);

  const startSpreadsheetUpload = useCallback(
    async (file: File): Promise<UploadResult> => {
      if (spreadsheetProgress.busy) {
        return { ok: false, error: "Spreadsheet import is already running." };
      }

      setDismissedProgress((prev) => ({ ...prev, spreadsheet: false }));
      setSpreadsheetProgress({
        busy: true,
        step: "Uploading and importing spreadsheet…",
        fileName: file.name,
      });

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/imports/spreadsheet", {
          method: "POST",
          body: formData,
        });

        let payload: { error?: string; rowsProcessed?: number } = {};
        try {
          payload = (await response.json()) as { error?: string; rowsProcessed?: number };
        } catch {
          payload = {};
        }

        if (!response.ok) {
          throw new Error(payload.error ?? "Spreadsheet import failed.");
        }

        pushNotification({
          tone: "success",
          title: "Spreadsheet import complete",
          detail: `${file.name}: ${payload.rowsProcessed ?? 0} rows processed.`,
          href: "/",
          actionLabel: "View households",
        });

        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushNotification({
          tone: "error",
          title: "Spreadsheet import failed",
          detail: `${file.name}: ${message}`,
        });
        return { ok: false, error: message };
      } finally {
        setSpreadsheetProgress(initialProgress);
      }
    },
    [pushNotification, spreadsheetProgress.busy],
  );

  const startAudioUpload = useCallback(
    async (file: File, householdId: string): Promise<UploadResult> => {
      if (audioProgress.busy) {
        return { ok: false, error: "Audio enrichment is already running." };
      }

      setDismissedProgress((prev) => ({ ...prev, audio: false }));
      setAudioProgress({
        busy: true,
        step: "Uploading audio and extracting facts…",
        fileName: file.name,
      });

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("householdId", householdId);

        const response = await fetch("/api/imports/audio", {
          method: "POST",
          body: formData,
        });

        let payload: {
          error?: string;
          factsExtracted?: number;
          autoApplied?: number;
          review_queue?: Array<unknown>;
        } = {};

        try {
          payload = (await response.json()) as {
            error?: string;
            factsExtracted?: number;
            autoApplied?: number;
            review_queue?: Array<unknown>;
          };
        } catch {
          payload = {};
        }

        if (!response.ok) {
          throw new Error(payload.error ?? "Audio import failed.");
        }

        pushNotification({
          tone: "success",
          title: "Audio enrichment complete",
          detail: `${file.name}: ${payload.factsExtracted ?? 0} facts, ${payload.autoApplied ?? 0} auto-applied, ${payload.review_queue?.length ?? 0} queued.`,
          href: `/households/${householdId}`,
          actionLabel: "Open household",
        });

        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushNotification({
          tone: "error",
          title: "Audio enrichment failed",
          detail: `${file.name}: ${message}`,
        });
        return { ok: false, error: message };
      } finally {
        setAudioProgress(initialProgress);
      }
    },
    [audioProgress.busy, pushNotification],
  );

  const value = useMemo<UploadManagerContextValue>(
    () => ({
      spreadsheetBusy: spreadsheetProgress.busy,
      spreadsheetStep: spreadsheetProgress.step,
      audioBusy: audioProgress.busy,
      audioStep: audioProgress.step,
      startSpreadsheetUpload,
      startAudioUpload,
    }),
    [
      audioProgress.busy,
      audioProgress.step,
      spreadsheetProgress.busy,
      spreadsheetProgress.step,
      startAudioUpload,
      startSpreadsheetUpload,
    ],
  );

  const hasRunningUploads = spreadsheetProgress.busy || audioProgress.busy;
  const hasNotifications = notifications.length > 0;

  return (
    <UploadManagerContext.Provider value={value}>
      {children}
      {hasRunningUploads || hasNotifications ? (
        <aside className="pointer-events-none fixed right-4 top-24 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3">
          {spreadsheetProgress.busy && !dismissedProgress.spreadsheet ? (
            <ProgressCard
              title="Spreadsheet import in progress"
              detail={spreadsheetProgress.step}
              fileName={spreadsheetProgress.fileName}
              onDismiss={() => setDismissedProgress((prev) => ({ ...prev, spreadsheet: true }))}
              dismissLabel="Dismiss spreadsheet import status"
            />
          ) : null}
          {audioProgress.busy && !dismissedProgress.audio ? (
            <ProgressCard
              title="Audio enrichment in progress"
              detail={audioProgress.step}
              fileName={audioProgress.fileName}
              onDismiss={() => setDismissedProgress((prev) => ({ ...prev, audio: true }))}
              dismissLabel="Dismiss audio enrichment status"
            />
          ) : null}

          {notifications.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              onDismiss={dismissNotification}
            />
          ))}
        </aside>
      ) : null}
    </UploadManagerContext.Provider>
  );
}

export function useUploadManager(): UploadManagerContextValue {
  const context = useContext(UploadManagerContext);
  if (!context) {
    throw new Error("useUploadManager must be used within UploadManagerProvider.");
  }
  return context;
}

function ProgressCard({
  title,
  detail,
  fileName,
  onDismiss,
  dismissLabel,
}: {
  title: string;
  detail: string;
  fileName: string;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  return (
    <div className="pointer-events-auto rounded-2xl border border-warning-border bg-warning-subtle/95 px-4 py-3 shadow-lg backdrop-blur-sm">
      <div className="flex items-start gap-3">
        <LoaderCircle className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-warning-text">{title}</p>
          <p className="mt-0.5 truncate text-xs text-warning-text/90">{fileName}</p>
          <p className="mt-1 text-xs text-warning-text">{detail}</p>
        </div>
        <button
          type="button"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="rounded p-1 text-warning transition hover:bg-warning-subtle"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function NotificationCard({
  notification,
  onDismiss,
}: {
  notification: UploadNotification;
  onDismiss: (id: string) => void;
}) {
  const success = notification.tone === "success";

  return (
    <div
      className={`pointer-events-auto rounded-2xl border px-4 py-3 shadow-lg backdrop-blur-sm ${
        success ? "border-success-border bg-success-subtle/95" : "border-error-border bg-error-subtle/95"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {success ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        ) : (
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
        )}

        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${success ? "text-success-text" : "text-error-text"}`}>
            {notification.title}
          </p>
          <p className={`mt-1 text-xs ${success ? "text-success-text" : "text-error-text"}`}>
            {notification.detail}
          </p>
          {notification.href ? (
            <Link
              href={notification.href}
              className={`mt-2 inline-flex text-xs font-semibold ${
                success ? "text-success-text hover:text-success" : "text-error-text hover:text-error"
              }`}
            >
              {notification.actionLabel ?? "Open"}
            </Link>
          ) : null}
        </div>

        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => onDismiss(notification.id)}
          className={`rounded p-1 transition ${
            success ? "text-success hover:bg-success-subtle" : "text-error hover:bg-error-subtle"
          }`}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
