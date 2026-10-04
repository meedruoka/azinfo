import React from 'react';
import ReactDOM from 'react-dom/client';
import { Options } from './Options';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Options root element missing');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Options />
  </React.StrictMode>,
);
