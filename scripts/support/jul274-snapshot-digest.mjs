// JUL-274: compare the authoritative simulation snapshot, not only aggregate
// behavioral counters. This is a read-only Node benchmark helper.
import { createHash } from 'node:crypto';
import { createWorldSnapshot } from '../../src/simulation/render-snapshot.js';

export function authoritativeSnapshotDigest(world) {
  const snapshot = createWorldSnapshot(world);
  const hash = createHash('sha256');
  hash.update(JSON.stringify(snapshot.base));
  // Hash the exact bytes, including tile state omitted from snapshot.base.
  for (const key of ['scalars', 'ids', 'types', 'plants']) {
    const column = snapshot.tileColumns[key];
    hash.update(new Uint8Array(column.buffer, column.byteOffset, column.byteLength));
  }
  hash.update(JSON.stringify({
    stats: snapshot.stats, events: snapshot.events, logs: snapshot.logs
  }));
  return hash.digest('hex');
}
