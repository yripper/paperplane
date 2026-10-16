/// Fixed-interval runner that skips a tick while the previous run is still
/// going (a slow first sweep over thousands of dialogs must not stack up)
/// and never dies on a task error.
export function startNonOverlappingLoop(
  task: () => Promise<void>,
  intervalMs: number,
  onError: (e: unknown) => void,
): () => void {
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    task()
      .catch(onError)
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  return () => clearInterval(timer);
}
