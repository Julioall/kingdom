// Preserve uninstrumented execution without extra clocks or persistent state.
// Each observer is optional; a phase is measured exactly once around its run.
export function samplePhase(observer, name, run) {
  if (!observer) return run();
  const start = performance.now();
  try { return run(); }
  finally { observer(name, performance.now() - start); }
}
