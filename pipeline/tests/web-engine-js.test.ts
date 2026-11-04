// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The plain-JavaScript engine is opt-in: about 4 MB in every package for
 *        the few browsers with no WebAssembly, so only a project that asks for it
 *        carries it, and only to the web.
 */
import { describe, it, expect } from 'vitest';

describe('web engineJs in a project', () => {
  const manifest = (web: Record<string, unknown> | undefined) =>
    ({ formatVersion: '1', name: 'g', ...(web ? { packaging: { platforms: { web } } } : {}) });

  it('is off unless the project turns it on, and reaches only the web export', async () => {
    const { parseManifest } = await import('../src/project/format');
    const { projectExportOptions } = await import('../src/export/projectExportOptions');
    expect((await projectExportOptions('/tmp/game', parseManifest(manifest(undefined)), 'web')).webEngineJs).toBeUndefined();
    expect((await projectExportOptions('/tmp/game', parseManifest(manifest({ engineJs: false })), 'web')).webEngineJs).toBeUndefined();
    const on = parseManifest(manifest({ engineJs: true }));
    expect(on.packaging?.platforms?.web?.engineJs).toBe(true);
    expect((await projectExportOptions('/tmp/game', on, 'web')).webEngineJs).toBe(true);
    expect((await projectExportOptions('/tmp/game', on, 'wechat')).webEngineJs).toBeUndefined();
  });
});
