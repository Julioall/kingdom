// Clock updates are lossy under overload: replaying hours of stale automatic
// ticks would freeze the UI. Manual advances are user commands and are never
// dropped by the clock's bounded backlog policy.
export function createAdvanceBackpressureQueue({ maxClockDays = 12, clockBatchDays = 3, manualBatchDays = 12 } = {}) {
  let queuedClockDays = 0;
  let queuedManualDays = 0;
  let discardedClockDays = 0;
  let dispatchedClockDays = 0;
  let dispatchedManualDays = 0;

  return {
    enqueue(days, source) {
      if (!Number.isSafeInteger(days) || days < 1 || days > 12) {
        throw new RangeError('Advance days must be a positive integer up to 12.');
      }
      if (source === 'manual') {
        if (queuedManualDays > Number.MAX_SAFE_INTEGER - days) {
          throw new RangeError('Manual advance queue capacity exceeded.');
        }
        queuedManualDays += days;
      } else if (source === 'clock') {
        const accepted = Math.min(days, maxClockDays - queuedClockDays);
        queuedClockDays += accepted;
        discardedClockDays += days - accepted;
      } else throw new TypeError('Unknown advance source.');
    },
    take(paused) {
      if (queuedManualDays > 0) {
        const days = Math.min(manualBatchDays, queuedManualDays);
        queuedManualDays -= days;
        dispatchedManualDays += days;
        return { source: 'manual', days };
      }
      if (!paused && queuedClockDays > 0) {
        const days = Math.min(clockBatchDays, queuedClockDays);
        queuedClockDays -= days;
        dispatchedClockDays += days;
        return { source: 'clock', days };
      }
      return null;
    },
    discardClock() {
      discardedClockDays += queuedClockDays;
      queuedClockDays = 0;
    },
    reset() {
      queuedClockDays = 0;
      queuedManualDays = 0;
      discardedClockDays = 0;
      dispatchedClockDays = 0;
      dispatchedManualDays = 0;
    },
    snapshot() {
      return { queuedClockDays, queuedManualDays, discardedClockDays, dispatchedClockDays, dispatchedManualDays };
    }
  };
}
