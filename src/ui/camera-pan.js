// JUL-275: camera pan limits and focal-point zoom do not depend on the DOM.
// Keep camera math at the same point in the UI event flow. The game coordinator
// still owns state, drawing, and its existing viewport update/clamping order.
export function clampCameraPan(width, height, zoom, panX, panY) {
  const mapSize = Math.min(width, height) * zoom;
  const maxX = Math.max(0, (mapSize - width) / 2);
  const maxY = Math.max(0, (mapSize - height) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, panX)),
    y: Math.max(-maxY, Math.min(maxY, panY))
  };
}

export function zoomCameraAtPoint({
  left, top, width, height, zoom, panX, panY,
  nextZoom, clientX, clientY, minZoom, maxZoom
}) {
  const centerX = left + width / 2, centerY = top + height / 2;
  const focusX = Number.isFinite(clientX) ? clientX : centerX;
  const focusY = Number.isFinite(clientY) ? clientY : centerY;
  const mapX = (focusX - centerX - panX) / zoom;
  const mapY = (focusY - centerY - panY) / zoom;
  const targetZoom = Math.max(minZoom, Math.min(maxZoom, nextZoom));
  return {
    zoom: targetZoom,
    panX: focusX - centerX - mapX * targetZoom,
    panY: focusY - centerY - mapY * targetZoom
  };
}
