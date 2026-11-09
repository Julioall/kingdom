// The Worker revision is a command-envelope sequence number. ACK/query/control
// messages can advance it without changing the materialized WorldView.
// A tile delta's baseRevision names the last materialized WorldView, not the
// latest control response. Do not let ACKs force a full resynchronization.
export function nextMaterializedWorldRevision(currentRevision, response) {
  if (response?.type !== 'snapshot' && response?.type !== 'world-delta')
    return currentRevision;
  if (!Number.isSafeInteger(response.revision) || response.revision < 0)
    throw new RangeError('Invalid materialized world revision.');
  return response.revision;
}
