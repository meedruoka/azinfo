import React from 'react';
import ReactDOM from 'react-dom/client';
import { uiLocale } from '@/lib/i18n';
import App from './App.tsx';
import './style.css';

// Language for screen readers, hyphenation and fonts (CJK).
document.documentElement.lang = uiLocale() ?? 'en';

const root = document.getElementById('root');
if (!root) throw new Error('Popup root element missing');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
