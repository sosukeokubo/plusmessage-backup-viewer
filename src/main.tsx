import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { applyTheme, readTheme } from './util/theme';
import './index.css';

// Apply the persisted theme before React mounts so dark mode doesn't flash.
applyTheme(readTheme());

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
