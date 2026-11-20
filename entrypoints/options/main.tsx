import React from 'react';
import ReactDOM from 'react-dom/client';
import { t, uiDirection, uiLocale } from '@/lib/i18n';
import { Options } from './Options';
import './style.css';

// Language for screen readers, hyphenation and fonts (CJK).
document.documentElement.lang = uiLocale() ?? 'en';
document.documentElement.dir = uiDirection();
document.title = t('optTitle');

const root = document.getElementById('root');
if (!root) throw new Error('Options root element missing');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>,
);
