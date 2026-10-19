import { StatusBadge, type Status } from "@/components/ui";
import { jobStatusLabel, type JobStatus } from "@/server/admin/format";

const TONE: Record<JobStatus, Status> = {
  done: "ready",
  queued: "processing",
  running: "processing",
  failed: "failed",
  blocked: "failed",
  cancelled: "deleted",
};

/** Done, Running, Queued, Failed, Blocked query or Cancelled, in the shared badge style. */
export function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <StatusBadge status={TONE[status]} className="leading-[normal]">
      {jobStatusLabel(status)}
    </StatusBadge>
  );
}
