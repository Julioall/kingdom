// Presentation-only sidebar formatting. Consumers provide snapshots, text
// escaping and calendars. No DOM access, Worker commands or game state writes.
export function speciesRowsHtml(species, counts, esc, fmt = String, labelKey = 'role') {
  return species.map(item => {
    const count = counts?.[item.id] || 0;
    const title = esc(item[labelKey] || '');
    const name = esc(item.name || '');
    return '<div class="species-row" title="' + title + '"><i class="species-dot" style="--species:'
      + item.color + '"></i><span>' + name + '</span><b>' + fmt(count) + '</b></div>';
  }).join('');
}

export function chronicleHtml(entries, calendarDate, esc, maxEntries = 40) {
  const recent = Array.isArray(entries) ? entries.slice(0, maxEntries) : [];
  return recent.map(entry => {
    const date = calendarDate(entry.day);
    return '<div class="event"><strong>' + esc(entry.category)
      + '</strong><p>' + esc(entry.text) + '</p><small>Dia ' + date.dayOfYear
      + ' · Ano ' + date.year + '</small></div>';
  }).join('') || '<div class="empty-state">A história começa aqui. Nascimentos, perdas, obras e conflitos aparecerão neste diário.</div>';
}
