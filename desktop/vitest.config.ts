// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Dedicated test config — deliberately NOT the app's vite.config.ts (which loads
// the Electron plugins). Tests run in plain Node; engine-coupled modules mock
// EngineHost and drive a real headless World from the built WASM SDK.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
