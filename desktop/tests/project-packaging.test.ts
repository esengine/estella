// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { parseManifest } from '../src/project/format';

describe('parseManifest — packaging', () => {
  it('parses a valid packaging section', () => {
    const m = parseManifest({
      name: 'X',
      packaging: {
        platform: 'wechat', config: 'shipping', sourceMaps: false, openFolder: true,
        outDir: { wechat: 'out/wx', web: 'out/web' },
      },
    });
    expect(m.packaging).toEqual({
      platform: 'wechat', config: 'shipping', sourceMaps: false, openFolder: true,
      outDir: { wechat: 'out/wx', web: 'out/web' },
    });
  });

  it('drops invalid platform/config + non-string outDir entries', () => {
    const m = parseManifest({
      name: 'X',
      packaging: { platform: 'switch', config: 'debug', sourceMaps: 'yes', outDir: { web: 'ok', desktop: 123 } },
    });
    expect(m.packaging).toEqual({ outDir: { web: 'ok' } });
  });

  it('omits packaging when absent', () => {
    expect(parseManifest({ name: 'X' }).packaging).toBeUndefined();
  });
});
