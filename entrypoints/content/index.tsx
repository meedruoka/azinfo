import ReactDOM from 'react-dom/client';
import { uiDirection } from '@/lib/i18n';
import { type PortalContext, parsePortalUrl } from '@/lib/portal/parse-portal-url';
import { Panel } from './Panel';
// Inlined into the script: avoids exposing a CSS file to the portal through
// web_accessible_resources, which cssInjectionMode 'ui' would need.
import panelCss from './panel.css?inline';

/** Fallback check interval; catches URL changes no event reported. */
const URL_POLL_MS = 1000;

export default defineContentScript({
  matches: ['https://portal.azure.com/*'],
  cssInjectionMode: 'manual',
  async main(ctx) {
    let context: PortalContext | null = null;
    let lastHref = '';

    // Panel in a shadow root on the html element, after body: never inside
    // the portal's own layout, and outside the body that docked mode narrows
    // (decision 009).
    const ui = await createShadowRootUi(ctx, {
      name: 'azinfo-panel',
      css: panelCss,
      // Closed: the portal's own scripts can't read the figures or click the
      // panel's buttons through element.shadowRoot.
      mode: 'closed',
      position: 'inline',
      anchor: 'html',
      append: 'last',
      // Keystrokes typed in the panel must not trigger portal shortcuts.
      isolateEvents: true,
      onMount: (container) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'azinfo-root';
        // The panel's own direction (Arabic: rtl), not the portal's (decision 007).
        wrapper.dir = uiDirection();
        container.append(wrapper);
        const root = ReactDOM.createRoot(wrapper);
        root.render(<Panel context={context} />);
        return root;
      },
      onRemove: (root) => root?.unmount(),
    });
    ui.mount();

    const onUrlChange = (href: string) => {
      if (href === lastHref) return;
      lastHref = href;
      context = parsePortalUrl(href);
      ui.mounted?.render(<Panel context={context} />);
    };

    // The portal is a single-page app that navigates with pushState.
    // In Chrome, `wxt:locationchange` comes from the Navigation API's
    // `navigate` event, which fires before `location.href` updates, so use the
    // URL carried by the event instead of reading `location`.
    ctx.addEventListener(window, 'wxt:locationchange', (event) => onUrlChange(event.newUrl.href));
    ctx.addEventListener(window, 'hashchange', () => onUrlChange(location.href));
    ctx.addEventListener(window, 'popstate', () => onUrlChange(location.href));
    ctx.setInterval(() => onUrlChange(location.href), URL_POLL_MS);
    onUrlChange(location.href);
  },
});
