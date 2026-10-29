// Camera height must not hide live resources. Spatial viewport culling still
// removes off-screen objects, but zoom never samples or removes visible veins.
export function shouldDrawMineralAtZoom(item, zoom, highlighted = false) {
  return (item.stone || 0) > .7
    || Math.max(item.gold || 0, item.silver || 0, item.copper || 0, item.iron || 0) > .05;
}
