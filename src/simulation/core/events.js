

export function log(w, text) {
    w.events.unshift({ day: w.day, text });
    if (w.events.length > 24) w.events.length = 24;
  }
