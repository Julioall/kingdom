// Avoid rebuilding an unchanged HUD DOM subtree on repeated game renders.
// Element identity is part of the key so replaced panels are initialized normally.
export function createHtmlDiffWriter() {
  const previous = new WeakMap();
  return (element, html) => {
    if (!element) return false;
    if (previous.get(element) === html) return false;
    element.innerHTML = html;
    previous.set(element, html);
    return true;
  };
}
