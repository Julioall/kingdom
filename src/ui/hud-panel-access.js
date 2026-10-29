// Closed off-canvas panels must not retain keyboard or screen-reader focus.
export function syncHudPanelAccess(leftPanel, rightPanel, { leftOpen = false, rightOpen = false } = {}) {
  for (const [panel, open] of [[leftPanel, leftOpen], [rightPanel, rightOpen]]) {
    panel.inert = !open;
    panel.setAttribute('aria-hidden', String(!open));
  }
}

// Surface survival-critical alerts even while optional environment details stay tucked away.
export function syncFoodPressureAlert(mapTags, foodPressureTag, peopleAtRisk) {
  const hasAlert = Number(peopleAtRisk) > 0;
  foodPressureTag.hidden = !hasAlert;
  mapTags.classList.toggle('has-alert', hasAlert);
}
