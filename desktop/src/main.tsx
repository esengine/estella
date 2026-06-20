import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Web fonts bundled locally so the editor renders identically offline.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

import './theme/tokens.css';
import './theme/global.css';
// dockview base styles first, then our override layer on top of them.
import 'dockview/dist/styles/dockview.css';
import './theme/dockview-theme.css';
import './theme/app.css';
import './theme/launcher.css';
import { App } from './App';
import { LogStore } from './store/LogStore';

// Capture console (editor + SDK + wasm) into the Output Log panel from startup.
LogStore.install();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
