"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Callout, Card, CheckIcon, Eyebrow, Mono, ProgressBar, cn } from "@/components/ui";
import type { JobView } from "@/server/files/jobs";
import type { AIStatus, CleaningMode, FileStatus } from "@/server/files/repo";
import type { StepView } from "@/server/files/steps";
import { tryAgainAction, waitForAiAction, type RetryResult } from "../actions";
import { addSample, secondsLeft, timeLeftLabel, type ProgressSample } from "../_lib/estimate";

const POLL_MS = 1000;

const pillBase =
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium no-underline transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const pillPrimary = "bg-ink text-white hover:text-white";
const pillSecondary = "border border-hairline bg-white text-ink";

export interface ProcessingPanelProps {
  fileId: string;
  fileName: string;
  mode: CleaningMode;
  /** Formatted row count such as "2,412,000", or null before the file has been profiled. */
  rowsLabel: string | null;
  /** The file was (or is being) cleaned in chunks. */
  large: boolean;
  /** The original copy still exists, so "Try again" can re-run the file. */
  canRetry: boolean;
  fileStatus: FileStatus;
  aiStatus: AIStatus;
  /** The file's own error message, used when the job payload has none. */
  fileError: string | null;
  initialJob: JobView | null;
  /** The six step labels before any job has written its own. */
  fallbackSteps: string[];
}

function isLive(job: JobView | null): boolean {
  return job !== null && (job.status === "queued" || job.status === "running");
}

/**
 * Live view of a file's clean job. Polls /api/jobs/<id> once a second while the job is queued or
 * running, and moves the user on when the file needs review or is ready. Terminal problems are
 * shown in place with the actions that fix them.
 */
export function ProcessingPanel(props: ProcessingPanelProps) {
  const router = useRouter();
  const { fileId } = props;

  const [job, setJob] = useState<JobView | null>(props.initialJob);
  const [track, setTrack] = useState<{ jobId: string | null; points: ProgressSample[] }>({ jobId: null, points: [] });
  const [pollError, setPollError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retrying, startRetry] = useTransition();
  // Server data is re-read once when a job finishes, or when the row count first becomes known.
  const refreshedFor = useRef<string>(
    props.initialJob && !isLive(props.initialJob) ? `${props.initialJob.id}:end` : "",
  );

  const live = isLive(job);
  const jobId = job?.id ?? null;
  // The job payload is the freshest source for file state while a job runs.
  const fileStatus = job?.fileStatus ?? props.fileStatus;
  const aiStatus = job?.aiStatus ?? props.aiStatus;
  const errorText = job?.error ?? props.fileError;

  useEffect(() => {
    if (!jobId || !live) return;
    let active = true;
    let inFlight = false;

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        if (!active) return;
        if (res.status === 401 || res.status === 403) {
          setPollError("Your session has ended. Sign in again to see progress.");
          return;
        }
        const body = (await res.json().catch(() => null)) as JobView | { error?: string } | null;
        if (!active) return;
        if (!res.ok || !body || !("steps" in body)) {
          const message = body && "error" in body && body.error ? body.error : "Could not load progress.";
          setPollError(message);
          return;
        }
        const next = body;
        setPollError(null);
        setJob(next);
        setTrack((prev) => ({
          jobId: next.id,
          points: addSample(prev.jobId === next.id ? prev.points : [], { at: Date.now(), progress: next.progress }),
        }));
      } catch {
        if (active) setPollError("Connection lost. Retrying…");
      } finally {
        inFlight = false;
      }
    };

    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [jobId, live]);

  useEffect(() => {
    if (!job) return;
    let key: string | null = null;
    if (!isLive(job)) key = `${job.id}:end`;
    else if (props.rowsLabel === null && job.steps[3] && job.steps[3].state !== "pending") key = `${job.id}:rows`;
    if (key === null || refreshedFor.current === key) return;
    refreshedFor.current = key;
    router.refresh();
  }, [job, props.rowsLabel, router]);

  useEffect(() => {
    if (live || !job) return;
    if (job.status === "done" && fileStatus === "needs_review" && aiStatus !== "unavailable") {
      router.replace(`/review/${fileId}`);
    } else if (fileStatus === "ready") {
      router.replace(`/report/${fileId}`);
    }
  }, [live, job, fileStatus, aiStatus, fileId, router]);

  // A job that stopped without the file being marked failed (or ready for review) is still a failure here.
  const stopped = job !== null && !live && job.status !== "done";
  const failed = !live && (fileStatus === "failed" || (stopped && fileStatus === "processing"));
  const cancelled = failed && (job?.status === "cancelled" || props.fileError === "Cancelled");
  const showAiUnavailable = !live && fileStatus === "needs_review" && aiStatus === "unavailable";
  const showProgress = job !== null && (live || job.status === "done");
  const seconds = live && job ? secondsLeft(track.jobId === job.id ? track.points : [], job.progress) : null;
  const timeLabel = live && job ? timeLeftLabel(job.progress, seconds) : null;
  const hasOther = failed || showAiUnavailable || props.large;

  const heading = cancelled
    ? "Cleaning cancelled"
    : failed
      ? "Cleaning stopped"
      : job?.status === "done"
        ? "Cleaning finished"
        : "Cleaning your file…";

  const steps: StepView[] =
    job && job.steps.length > 0
      ? job.steps
      : props.fallbackSteps.map((label) => ({ label, state: "pending" as const }));
  // A stopped job has no active step, so nothing should look like it is still working.
  const shownSteps: StepView[] = failed
    ? steps.map((s) => (s.state === "active" ? { ...s, state: "pending" as const } : s))
    : steps;

  const aiNeverRan = aiStatus === "none" || aiStatus === "skipped";
  const failedBody = cancelled
    ? props.canRetry
      ? "Nothing was changed. Try again when you're ready."
      : "Nothing was changed. Upload the file again when you're ready."
    : [errorText ?? "Something went wrong while cleaning this file. Try again.", aiNeverRan ? "Nothing was sent to AI." : null]
        .filter(Boolean)
        .join(" ");

  async function cancelJob() {
    if (!job) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/cancel`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setCancelError(body?.error ?? "Could not cancel the job. Try again.");
        setCancelling(false);
        return;
      }
      router.push("/files");
    } catch {
      setCancelError("Could not cancel the job. Check your connection and try again.");
      setCancelling(false);
    }
  }

  function retry(action: (fileId: string) => Promise<RetryResult>) {
    setRetryError(null);
    startRetry(async () => {
      const result = await action(fileId);
      if (!result.ok) {
        setRetryError(result.error);
        return;
      }
      // Start following the new job at once; the poll fills in the real steps.
      setPollError(null);
      setTrack({ jobId: result.jobId, points: [] });
      setJob({
        id: result.jobId,
        type: "clean",
        status: "queued",
        step: "",
        progress: 0,
        error: null,
        fileId,
        fileStatus: "processing",
        aiStatus: "pending",
        steps: [],
      });
    });
  }

  return (
    <main
      className={cn(
        "mx-auto grid grid-cols-1 items-start gap-8 px-4 py-12 sm:px-8 lg:py-16",
        hasOther ? "max-w-[1344px] lg:grid-cols-2" : "max-w-[720px]",
      )}
    >
      <Card className="flex min-w-0 flex-col gap-6 p-6 sm:p-8">
        <div className="flex flex-col gap-2">
          <Mono className="text-slate break-all">{props.fileName}</Mono>
          <h1 className="text-[28px] font-semibold leading-[1.25]">{heading}</h1>
        </div>

        {showProgress && job && (
          <div className="flex flex-col gap-2">
            <ProgressBar value={job.progress} label="Cleaning progress" />
            <div className="flex justify-between gap-4 text-[13px] text-slate">
              <span>{job.progress}%</span>
              {timeLabel && <span>{timeLabel}</span>}
            </div>
          </div>
        )}

        {pollError && (
          <p role="status" className="m-0 text-[13px] text-slate">
            {pollError}
          </p>
        )}

        <ol className="m-0 flex list-none flex-col gap-3.5 p-0 text-sm">
          {shownSteps.map((step, i) => (
            <li
              key={`${i}-${step.label}`}
              className={cn(
                "flex items-center gap-3",
                step.state === "active" && "font-semibold",
                step.state === "pending" && "text-muted",
              )}
            >
              {step.state === "done" && <CheckIcon size={18} className="shrink-0 text-mint-deep" />}
              {step.state === "active" && (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <circle cx="12" cy="12" r="8" strokeDasharray="30 20" />
                </svg>
              )}
              {step.state === "pending" && (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#C5C9CF"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <circle cx="12" cy="12" r="8" />
                </svg>
              )}
              {step.label}
            </li>
          ))}
        </ol>

        {live && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-4">
            <span className="text-sm text-slate">
              You can leave this page. We&apos;ll keep working and it will appear in your files.
            </span>
            <button
              type="button"
              onClick={cancelJob}
              disabled={cancelling}
              className={cn(pillBase, pillSecondary, "text-ink")}
            >
              Cancel job
            </button>
          </div>
        )}
        {cancelError && (
          <p role="alert" className="m-0 text-sm text-error-ink">
            {cancelError}
          </p>
        )}
      </Card>

      {hasOther && (
        <section className="flex min-w-0 flex-col gap-4">
          <Eyebrow>Other states</Eyebrow>

          {failed && (
            <Callout
              tone="error"
              title={
                <span className="flex items-center gap-2.5 text-base leading-[normal]">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.25"
                    strokeLinecap="round"
                    aria-hidden="true"
                    className="shrink-0 text-error"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v6M12 16.5v.5" />
                  </svg>
                  {cancelled ? "Cleaning was cancelled" : "We couldn't read this file"}
                </span>
              }
            >
              <div className="mt-3 flex flex-col gap-3">
                <p className="m-0 text-sm leading-normal text-slate">{failedBody}</p>
                <div className="flex flex-wrap gap-2">
                  {props.canRetry && (
                    <button
                      type="button"
                      onClick={() => retry(tryAgainAction)}
                      disabled={retrying}
                      className={cn(pillBase, pillPrimary)}
                    >
                      Try again
                    </button>
                  )}
                  <Link href="/upload" className={cn(pillBase, props.canRetry ? pillSecondary : pillPrimary)}>
                    Upload again
                  </Link>
                </div>
                {retryError && (
                  <p role="alert" className="m-0 text-sm text-error-ink">
                    {retryError}
                  </p>
                )}
              </div>
            </Callout>
          )}

          {showAiUnavailable && (
            <Callout
              tone="review"
              title={<span className="text-base leading-[normal]">AI is temporarily unavailable</span>}
            >
              <div className="mt-3 flex flex-col gap-3">
                <p className="m-0 text-sm leading-normal text-slate">
                  Rule-based changes are ready to review now. AI suggestions will be added when the service is back,
                  or you can skip them.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/review/${fileId}`} className={cn(pillBase, pillPrimary)}>
                    Review rule changes
                  </Link>
                  {props.mode === "rules_ai" && (
                    <button
                      type="button"
                      onClick={() => retry(waitForAiAction)}
                      disabled={retrying}
                      className={cn(pillBase, pillSecondary)}
                    >
                      Wait for AI
                    </button>
                  )}
                </div>
                {retryError && (
                  <p role="alert" className="m-0 text-sm text-error-ink">
                    {retryError}
                  </p>
                )}
              </div>
            </Callout>
          )}

          {props.large && (
            <Callout
              tone="info"
              className="border border-hairline"
              title={<span className="text-base leading-[normal]">Large file · processing in chunks</span>}
            >
              <p className="mb-0 mt-2 text-sm leading-normal text-slate">
                {props.rowsLabel ? `${props.rowsLabel} rows. ` : ""}We stream this file in parts so memory stays
                stable. Results appear when every chunk is done.
              </p>
            </Callout>
          )}
        </section>
      )}
    </main>
  );
}
