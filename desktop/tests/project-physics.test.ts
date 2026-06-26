// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  parseManifest — physics world config (Project Settings → Physics). Guards that
 *        the solver tuning + collision matrix round-trip through project.esproject and
 *        that invalid values are dropped/clamped.
 */
import { describe, it, expect } from 'vitest';
import { parseManifest } from '../src/project/format';

describe('parseManifest — physics', () => {
  it('parses the full physics world config', () => {
    const m = parseManifest({
      name: 'X',
      features: {
        physics: {
          enabled: true,
          gravity: { x: 0, y: -20 },
          collisionLayers: ['Default', 'Player'],
          collisionLayerMasks: [0xffff, 0x0005],
          fixedTimestep: 0.02,
          subStepCount: 6,
          contactHertz: 60,
          contactDampingRatio: 5,
          contactSpeed: 8,
          enableSleep: false,
          enableContinuous: false,
        },
      },
    });
    expect(m.features?.physics).toMatchObject({
      enabled: true,
      gravity: { x: 0, y: -20 },
      collisionLayerMasks: [0xffff, 0x0005],
      fixedTimestep: 0.02,
      subStepCount: 6,
      contactHertz: 60,
      contactDampingRatio: 5,
      contactSpeed: 8,
      enableSleep: false,
      enableContinuous: false,
    });
    expect(m.features?.physics?.collisionLayers?.slice(0, 2)).toEqual(['Default', 'Player']);
  });

  it('drops non-numeric solver values and masks bad matrix rows to all-collide', () => {
    const m = parseManifest({
      name: 'X',
      features: { physics: { fixedTimestep: 'fast', contactHertz: 90, collisionLayerMasks: [3, 'x', 7] } },
    });
    const p = m.features?.physics;
    expect(p?.fixedTimestep).toBeUndefined();    // invalid → dropped (runtime default applies)
    expect(p?.contactHertz).toBe(90);
    expect(p?.collisionLayerMasks).toEqual([3, 0xffff, 7]); // bad row → all-collide
  });

  it('omits physics when absent', () => {
    expect(parseManifest({ name: 'X' }).features?.physics).toBeUndefined();
  });
});
