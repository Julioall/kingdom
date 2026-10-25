import { chronicleEntry } from './chronicle.js';

export function log(w, text, day = w.day) {
  w.events.unshift({ day, text });
  if (w.events.length > 64) w.events.length = 64;
  const entry = chronicleEntry(text);
  if (entry) {
    const journal = (w.chronicle ||= []);
    // Repeated daily alerts should not displace births, losses and milestones.
    if (!journal.some(e => e.text === entry.text && day - e.day < 30)) journal.unshift({ day, ...entry });
    if (journal.length > 120) journal.length = 120;
  }
  }
