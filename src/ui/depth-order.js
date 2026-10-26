export const compareDepth = (a, b) => a.depth - b.depth || a.order - b.order || a.sequence - b.sequence || a.id - b.id;

// Static items are already sorted at snapshot arrival; only actors and effects
// need sorting every frame. Merge preserves the original total paint order.
export function mergeDepthItems(staticItems, dynamicItems) {
  dynamicItems.sort(compareDepth);
  const merged = new Array(staticItems.length + dynamicItems.length);
  let a = 0, b = 0, index = 0;
  while (a < staticItems.length && b < dynamicItems.length) {
    merged[index++] = compareDepth(staticItems[a], dynamicItems[b]) <= 0 ? staticItems[a++] : dynamicItems[b++];
  }
  while (a < staticItems.length) merged[index++] = staticItems[a++];
  while (b < dynamicItems.length) merged[index++] = dynamicItems[b++];
  return merged;
}
