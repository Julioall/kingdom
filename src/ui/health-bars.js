export function createDamageBarTracker(durationMs = 5000) {
  const records = new Map();
  return {
    observe(people, now, reset = false) {
      if (reset) records.clear();
      const living = new Set();
      for (const person of people) {
        if (!person.alive) continue;
        living.add(person.id);
        const sequence = person.lastAttackSequence || 0;
        const previous = records.get(person.id);
        const changed = !reset && sequence > 0 && sequence !== (previous?.sequence || 0);
        records.set(person.id, { sequence, until: changed ? now + durationMs : previous?.until || 0 });
      }
      for (const id of records.keys()) if (!living.has(id)) records.delete(id);
    },
    visible(personId, now) { return now < (records.get(personId)?.until || 0); }
  };
}
