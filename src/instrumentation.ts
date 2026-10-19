/**
 * Server start-up, run once per Node.js server instance. Registers the clean job handler, starts the
 * job runner, and sweeps expired files now and every five minutes.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const [{ registerCleanHandler }, { startJobRunner }, { sweepExpiredFiles }] = await Promise.all([
    import("./server/jobs/handlers/clean"),
    import("./server/jobs/queue"),
    import("./server/files/retention"),
  ]);

  registerCleanHandler();
  startJobRunner();

  const sweep = () =>
    sweepExpiredFiles().catch((err: unknown) => {
      console.error("[retention] sweep failed", err);
    });
  void sweep();
  setInterval(() => void sweep(), 5 * 60 * 1000).unref();
}
