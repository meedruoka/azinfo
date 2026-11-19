// Renders one store-screenshot scene with the real azinfo components and
// sample data. Scene from the URL: ?scene=resource|spike|group|popup|pill|options
import type { ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import { Panel } from '@/entrypoints/content/Panel';
import panelCss from '@/entrypoints/content/panel.css?inline';
import { Options } from '@/entrypoints/options/Options';
import optionsCss from '@/entrypoints/options/style.css?inline';
import { App } from '@/entrypoints/popup/App';
import popupCss from '@/entrypoints/popup/style.css?inline';
import { contexts, sampleRequest } from './data';
import { presetStorage } from './storage-shim';

const scene = new URLSearchParams(location.search).get('scene') ?? 'resource';
const request = sampleRequest as never;

/** Page-level styles become host styles inside a shadow root. */
const forShadow = (css: string) => css.replace(/:root/g, ':host').replace(/\bbody\b/g, ':host');

/** Renders `node` in an open shadow root, like the extension isolates its UI. */
function mount(className: string, css: string, node: ReactNode) {
  const host = document.createElement('div');
  host.className = className;
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const root = document.createElement('div');
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
    presetStorage({ 'local:panel.collapsed': scene === 'pill' });
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
    presetStorage({ 'local:panel.collapsed': false });
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
