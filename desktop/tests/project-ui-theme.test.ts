// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  parseManifest — ui feature (Project Settings → UI). Guards the widget
 *        theme + per-role color overrides: 'light' persists (dark = absence),
 *        overrides keep only known roles with valid hex, and an empty ui block
 *        disappears entirely.
 */
import { describe, it, expect } from 'vitest';
import { parseManifest } from '../src/project/format';

describe('parseManifest — features.ui', () => {
  it("keeps theme 'light'; dark/junk = absence", () => {
    expect(parseManifest({ name: 'X', features: { ui: { theme: 'light' } } }).features?.ui?.theme).toBe('light');
    for (const v of ['dark', 'LIGHT', 42, null]) {
      expect(parseManifest({ name: 'X', features: { ui: { theme: v } } }).features?.ui).toBeUndefined();
    }
  });

  it('keeps only known roles with valid hex (lowercased), drops the rest', () => {
    const m = parseManifest({
      name: 'X',
      features: {
        ui: {
          colors: {
            primary: '#FF0000',
            backdrop: '#00000080',
            surface: 'red',
            notARole: '#00ff00',
            control: 42,
          },
        },
      },
    });
    expect(m.features?.ui?.colors).toEqual({ primary: '#ff0000', backdrop: '#00000080' });
  });

  it('colors coexist with a light base; all-junk colors vanish', () => {
    const m = parseManifest({ name: 'X', features: { ui: { theme: 'light', colors: { primary: '#123456' } } } });
    expect(m.features?.ui).toEqual({ theme: 'light', colors: { primary: '#123456' } });
    const m2 = parseManifest({ name: 'X', features: { ui: { colors: { nope: 'junk' } } } });
    expect(m2.features?.ui).toBeUndefined();
  });
});
