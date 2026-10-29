// Closed off-canvas panels must not retain keyboard or screen-reader focus.
export function syncHudPanelAccess(leftPanel, rightPanel, { leftOpen = false, rightOpen = false } = {}) {
  for (const [panel, open] of [[leftPanel, leftOpen], [rightPanel, rightOpen]]) {
    if (!open) {
      const focused = panel.ownerDocument?.activeElement;
      if (focused && panel.contains(focused)) focused.blur();
    }
    panel.inert = !open;
    panel.setAttribute('aria-hidden', String(!open));
  }
}
