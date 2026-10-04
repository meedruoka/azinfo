import { parsePortalUrl } from '@/lib/portal/parse-portal-url';

/** Fallback check interval; catches URL changes no event reported. */
const URL_POLL_MS = 1000;

export default defineContentScript({
  matches: ['https://portal.azure.com/*'],
  main(ctx) {
    let lastHref = '';

    const onUrlChange = (href: string) => {
      if (href === lastHref) return;
      lastHref = href;
      // M0: log only. The floating panel arrives in M3.
      console.info('[azinfo] portal context', parsePortalUrl(href), href);
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
