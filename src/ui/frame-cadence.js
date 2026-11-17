// Presentation cadence is independent of the simulation tick and the Worker.
// Default remains the validated 60 Hz path until higher rates pass browser QA.
export const DEFAULT_RENDER_HZ = 60;

export function parseRenderHz(value) {
  if (value === 'display') return 'display';
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return DEFAULT_RENDER_HZ;
  const hz = Number(value);
  return hz >= 30 && hz <= 240 ? hz : DEFAULT_RENDER_HZ;
}

export function shouldPaintFrame(now, lastPaint, pending, hz = DEFAULT_RENDER_HZ) {
  if (pending || !Number.isFinite(lastPaint) || lastPaint <= 0) return true;
  if (!Number.isFinite(now) || now < lastPaint) return false;
  if (hz === 'display') return true;
  return now - lastPaint >= 1000 / hz - .5;
}

export function nextPaintTimestamp(now, lastPaint, hz = DEFAULT_RENDER_HZ) {
  if (!Number.isFinite(now)) return lastPaint;
  if (hz === 'display' || !Number.isFinite(lastPaint) || lastPaint <= 0 || now < lastPaint) return now;
  const interval = 1000 / hz;
  const elapsed = now - lastPaint;
  return elapsed >= interval ? now - elapsed % interval : now;
}
