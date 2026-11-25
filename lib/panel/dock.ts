/**
 * Docked mode (decision 009): the panel becomes a full-height sidebar on the
 * right and the portal is narrowed to make room, instead of the card floating
 * over it. Every change to the portal's page is one class on <html>, one CSS
 * variable and one <style> element, all removed by `undock`.
 */

export type PanelLayout = 'floating' | 'docked';

export const DOCK_WIDTH = { min: 300, default: 380, max: 640 } as const;
/** Narrower than this, the portal would be cramped: the panel floats instead. */
export const MIN_PAGE_WIDTH = 720;

const CLASS = 'azinfo-docked';
const STYLE_ID = 'azinfo-dock-style';
const WIDTH_VAR = '--azinfo-dock-width';

/**
 * The portal's layout fills <body> and uses fixed positioning. Narrowing
 * <body> and making it the containing block of its fixed elements
 * (`transform`) keeps the whole portal, its top bar and its menus, left of
 * the sidebar. The panel's own host sits on <html>, outside <body>, so it
 * stays in place.
 */
const DOCK_CSS = `
html.${CLASS} {
  overflow: hidden !important;
}
html.${CLASS} > body {
  width: calc(100vw - var(${WIDTH_VAR})) !important;
  min-width: 0 !important;
  max-width: none !important;
  height: 100vh !important;
  overflow: hidden !important;
  transform: translateZ(0) !important;
}
`;

export function clampDockWidth(width: number, viewportWidth: number): number {
  const room = Math.max(DOCK_WIDTH.min, viewportWidth - MIN_PAGE_WIDTH);
  const max = Math.min(DOCK_WIDTH.max, room);
  if (!Number.isFinite(width)) return Math.min(DOCK_WIDTH.default, max);
  return Math.round(Math.min(Math.max(width, DOCK_WIDTH.min), max));
}

/** Whether the window leaves the portal enough room beside the sidebar. */
export function canDock(viewportWidth: number): boolean {
  return viewportWidth >= MIN_PAGE_WIDTH + DOCK_WIDTH.min;
}

let pendingUndock: ReturnType<typeof setTimeout> | undefined;

/**
 * Undocks on the next task unless `dock` is called first. Navigating between
 * resources remounts the panel; this keeps the portal from jumping back to
 * full width and in again between the two.
 */
export function releaseDock(doc: Document): void {
  clearTimeout(pendingUndock);
  pendingUndock = setTimeout(() => {
    pendingUndock = undefined;
    undock(doc);
  }, 0);
}

/** Narrows the portal to leave `width` pixels on the right. Idempotent. */
export function dock(doc: Document, width: number): void {
  clearTimeout(pendingUndock);
  pendingUndock = undefined;
  const root = doc.documentElement;
  if (!doc.getElementById(STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = DOCK_CSS;
    (doc.head ?? root).append(style);
  }
  const value = `${width}px`;
  const changed =
    !root.classList.contains(CLASS) || root.style.getPropertyValue(WIDTH_VAR) !== value;
  root.style.setProperty(WIDTH_VAR, value);
  root.classList.add(CLASS);
  if (changed) notifyResize(doc);
}

/** Gives the portal back its full width, leaving nothing of azinfo behind. */
export function undock(doc: Document): void {
  const root = doc.documentElement;
  const was = root.classList.contains(CLASS);
  root.classList.remove(CLASS);
  root.style.removeProperty(WIDTH_VAR);
  if (!root.getAttribute('style')) root.removeAttribute('style');
  doc.getElementById(STYLE_ID)?.remove();
  if (was) notifyResize(doc);
}

export function isDocked(doc: Document): boolean {
  return doc.documentElement.classList.contains(CLASS);
}

/** The portal lays some blades out in script on window resize. */
function notifyResize(doc: Document) {
  doc.defaultView?.dispatchEvent(new Event('resize'));
}
