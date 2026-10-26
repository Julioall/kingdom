export const SOURCE_TILE_PIXELS = 64;
export const spriteScale = (tileSize, factor = 1) => tileSize / SOURCE_TILE_PIXELS * factor;

export const BUILDING_FEET = Object.freeze({ castle: 249, barracks: 245, tower: 230,
  house1: 173, house2: 178, house3: 172, farmhouse: 168, archery: 240, monastery: 310 });

export function alignedTileRect(x, y, size, transform) {
  const [sx, , , sy, tx, ty] = transform;
  const left = Math.round(x * sx + tx), top = Math.round(y * sy + ty);
  const right = Math.round((x + size) * sx + tx), bottom = Math.round((y + size) * sy + ty);
  return [(left - tx) / sx, (top - ty) / sy, (right - left) / sx, (bottom - top) / sy];
}

export function mapCamera(width, height, zoom = 1, panX = 0, panY = 0, dpr = 1, logicalSize = 1024) {
  width = Math.max(1, width); height = Math.max(1, height);
  const scale = Math.min(width, height) / logicalSize * zoom;
  const offsetX = Math.round((width / 2 + panX - logicalSize * scale / 2) * dpr) / dpr;
  const offsetY = Math.round((height / 2 + panY - logicalSize * scale / 2) * dpr) / dpr;
  const x = Math.max(0, Math.min(logicalSize, -offsetX / scale));
  const y = Math.max(0, Math.min(logicalSize, -offsetY / scale));
  const right = Math.max(x, Math.min(logicalSize, (width - offsetX) / scale));
  const bottom = Math.max(y, Math.min(logicalSize, (height - offsetY) / scale));
  return { scale, offsetX, offsetY, width: Math.ceil(width * dpr), height: Math.ceil(height * dpr),
    transform: [scale * dpr, 0, 0, scale * dpr, offsetX * dpr, offsetY * dpr],
    view: { x, y, width: right - x, height: bottom - y },
    toWorld: (x, y) => ({ x: (x - offsetX) / scale, y: (y - offsetY) / scale }) };
}
