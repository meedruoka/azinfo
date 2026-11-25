// Renders one store-screenshot scene with the real azinfo components and
// sample data. Scene from the URL: ?scene=resource|spike|group|popup|pill|options,
// and ?layout=docked for the panel docked as a sidebar (decision 009).
import type { ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { Panel } from '@/entrypoints/content/Panel';
import panelCss from '@/entrypoints/content/panel.css?inline';
import { Options } from '@/entrypoints/options/Options';
import optionsCss from '@/entrypoints/options/style.css?inline';
import { App } from '@/entrypoints/popup/App';
import popupCss from '@/entrypoints/popup/style.css?inline';
import { uiDirection } from '@/lib/i18n';
import { contexts, sampleRequest } from './data';
import { presetStorage } from './storage-shim';

const params = new URLSearchParams(location.search);
const scene = params.get('scene') ?? 'resource';
const layout = params.get('layout') === 'docked' ? 'docked' : 'floating';
const request = sampleRequest as never;

// ?lang=ar (or any shipped locale): answer the i18n API from that locale file,
// like Chrome does, so a language and its direction can be checked by eye.
const locales = import.meta.glob<Record<string, { message: string }>>(
  '../../public/_locales/*/messages.json',
  { eager: true, import: 'default' },
);
const lang = params.get('lang');
const messages = lang ? locales[`../../public/_locales/${lang}/messages.json`] : undefined;
if (messages) {
  const rtl = ['ar', 'he', 'fa'].includes(lang ?? '');
  (globalThis as { browser?: unknown }).browser = {
    i18n: {
      getUILanguage: () => lang?.replace('_', '-'),
      getMessage: (key: string, subs: string[] = []) =>
        key === '@@bidi_dir'
          ? rtl
            ? 'rtl'
            : 'ltr'
          : (messages[key]?.message ?? '').replace(
              /\$([1-9])/g,
              (_, n) => subs[Number(n) - 1] ?? '',
            ),
    },
  };
}

/** Page-level styles become host styles inside a shadow root. */
const forShadow = (css: string) => css.replace(/:root/g, ':host').replace(/\bbody\b/g, ':host');

/** Renders `node` in an open shadow root, like the extension isolates its UI. */
function mount(className: string, css: string, node: ReactNode) {
  const host = document.createElement('div');
  host.className = className;
  // Like the extension: on the html element, outside the body docking narrows.
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const root = document.createElement('div');
  root.dir = uiDirection();
  shadow.append(style, root);
  ReactDOM.createRoot(root).render(node);
}

/** A neutral stand-in page behind the UI: azinfo's own UI is the subject. */
function backdrop(title: string, subtitle: string) {
  const heading = document.getElementById('title');
  const sub = document.getElementById('subtitle');
  if (heading) heading.textContent = title;
  if (sub) sub.textContent = subtitle;
}

switch (scene) {
  case 'resource':
  case 'spike':
  case 'pill': {
    const context = scene === 'spike' ? contexts.batch : contexts.web;
    backdrop(
      scene === 'spike' ? 'shop-batch-vm' : 'shop-web',
      scene === 'spike' ? 'Virtual machine · rg-shop-prod' : 'App Service · rg-shop-prod',
    );
    presetStorage({ 'local:panel.collapsed': scene === 'pill', 'local:panel.layout': layout });
    mount(
      '',
      panelCss,
      <div className="azinfo-root">
        <Panel context={context} request={request} />
      </div>,
    );
    break;
  }
  case 'group':
    backdrop('rg-shop-prod', 'Resource group · Production');
    presetStorage({ 'local:panel.collapsed': false, 'local:panel.layout': layout });
    mount(
      '',
      panelCss,
      <div className="azinfo-root">
        <Panel context={contexts.group} request={request} />
      </div>,
    );
    break;
  case 'popup':
    backdrop('Production', 'Subscription overview');
    document.body.classList.add('with-popup');
    mount('popup-frame', forShadow(popupCss), <App request={request} />);
    break;
  case 'options':
    backdrop('azinfo options', 'Settings');
    document.body.classList.add('with-options');
    mount('options-frame', forShadow(optionsCss), <Options request={request} />);
    break;
}
