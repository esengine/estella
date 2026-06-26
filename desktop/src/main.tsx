// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
import './theme/inspector.css';
import './theme/outliner.css';
import './theme/log.css';
import './theme/viewport.css';
import './theme/content.css';
import './theme/sequencer.css';
import './theme/tileset.css';
import './theme/tilemap.css';
import './theme/material.css';
import './theme/chrome.css';
import './theme/menus.css';
import './theme/settings.css';
import './theme/launcher.css';
import { App } from './App';
import { LogStore } from './store/LogStore';
import { initFsWatch } from './project/fsWatch';
// Register the built-in settings (side effect) and replay persisted ones.
import './settings';
import { applySettings } from './store/settingsStore';

// Capture console (editor + SDK + wasm) into the Output Log panel from startup.
LogStore.install();
// Apply persisted editor settings (accent, UI scale, log cap) before first paint.
applySettings();
// Live-sync the asset registry + Content Browser with on-disk changes (incl.
// edits made outside the editor) via the main-process project watcher.
initFsWatch();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
