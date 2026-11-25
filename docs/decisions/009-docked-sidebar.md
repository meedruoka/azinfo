# 009: Docked sidebar mode

- **Status:** Implemented on `main` after 0.1.4; not released. Checked in the tests and on the sample
  page (`pnpm store:shots` page, `?scene=group&layout=docked`). It hasn't been checked yet on the
  real Azure portal (see [To check on the real portal](#to-check-on-the-real-portal)).
- **Date:** 2026-11-25

## Context

The resource-group view now shows a lot: totals, the daily trend, the meter breakdown, every
resource and the Advisor tips. In a 346px card floating over the bottom-right corner, it covers the
portal and the resource list scrolls inside a 240px box. Some extensions (reading and AI
assistants, for example) offer a second layout: a sidebar docked on the right, with the page
narrowed beside it instead of covered.

## Options

1. **Browser side panel (`chrome.sidePanel`, Chrome 114+, Edge).** The browser owns the panel, so
   nothing in the page changes. But it needs a new `sidePanel` permission, which means a new store
   review and a new warning for work admins. It needs a user gesture to open. The panel would also
   have to follow the portal's address from outside the page, and it looks like browser chrome,
   not part of the portal.
2. **Injected sidebar that narrows the page (chosen).** It keeps the same content script, shadow
   root and permissions, and the floating card stays as it is.

Practices that apply to an injected sidebar, and how azinfo follows them:

- **Keep the UI isolated.** The panel stays in its closed shadow root with inlined CSS, as before.
- **Change the page as little as possible, label it, and make it reversible.** Docking adds one
  class (`azinfo-docked`) and one CSS variable (`--azinfo-dock-width`) to the html element, plus
  one `<style id="azinfo-dock-style">`. `undock` removes all three, and the tests check that
  nothing is left.
- **Push, don't cover.** The page's body is narrowed with
  `width: calc(100vw - var(--azinfo-dock-width))`. `transform: translateZ(0)` makes the body the
  containing block of the portal's `position: fixed` elements (top bar, menus, flyouts), so they
  stay left of the sidebar too. Only that works for a single-page app laid out with fixed
  positioning; a margin on the html element doesn't.
- **Keep the panel outside what you narrow.** The shadow host now sits on the html element after
  the body (`anchor: 'html'`), so the narrowed, transformed body doesn't contain it.
- **Tell the page.** A `resize` event goes out after each change, for portal code that lays blades
  out on resize.
- **Don't cramp small windows.** Below 1020px (720px for the portal + the 300px minimum sidebar)
  the panel floats, and the switch is hidden.
- **Resizable and remembered.** The left edge can be dragged (300 to 640px, always leaving the
  portal 720px), or moved with ←/→ when focused (a `separator` with `aria-valuenow`). The width
  and the layout are kept in `local:panel.dockWidth` and `local:panel.layout`, like the collapsed
  state.
- **No flicker on navigation.** Moving between resources remounts the panel. Undocking waits one
  task (`releaseDock`), and the new panel docks again in time, so the portal doesn't jump.

## Decision

- A switch in the panel header (next to "Collapse"): **Dock as a sidebar** / **Float over the
  page**. Its icon shows where the click takes the panel. Floating stays the default.
- Docked: full height on the right in every language (physical, as in 007). The header stays
  visible while scrolling, and the resource list isn't capped at 240px.
- Collapsing a docked panel gives the portal its full width back and shows the usual pill.
  Expanding it docks again. Pages without the panel are never narrowed.
- Fixed in passing: a tall floating card overflowed the top of the window by its padding and
  border (`max-height` applied to the content box). It now uses `box-sizing: border-box` with the
  same 346px outer width.

## To check on the real portal

- [ ] The portal's top bar, blades and context menus all fit left of the sidebar, at 1280px and
      1920px.
- [ ] Opening a blade or a flyout while docked lays out in the narrowed width, with no horizontal
      scroll bar.
- [ ] Switching back to floating restores the full width without a reload.
- [ ] Portal dialogs (for example "Delete resource group") are still centred and usable.
