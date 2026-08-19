// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The status bar's selection readout: what it reports about a transform.
 *        A flat, Z-turned one must read as the two numbers and one angle it always
 *        did; a posed one must not have its pose reported as a Z angle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  entity: null as { components: Array<{ type: string; data: unknown }> } | null,
}));

vi.mock('@/engine/SceneModel', () => ({
  SceneModel: { entityBySource: () => h.entity, subscribe: () => () => {} },
}));
vi.mock('@/engine/EngineHost', () => ({ EngineHost: {} }));

import { sampleSelection } from '@/engine/StatsStore';
import { useSelection } from '@/store/selectionStore';
import { eulerToQuat } from '@/engine/schema';

const transform = (position: unknown, rotation?: unknown): void => {
  h.entity = { components: [{ type: 'Transform', data: { position, rotation } }] };
};

beforeEach(() => {
  h.entity = null;
  useSelection.getState().select(null);
});

describe('the selection readout', () => {
  it('reports nothing without exactly one selection', () => {
    expect(sampleSelection()).toBeNull();
  });

  it('a flat, Z-turned transform reports two numbers and one angle', () => {
    transform({ x: 12.34, y: -5 }, eulerToQuat([0, 0, 30]));
    useSelection.getState().select(7);
    const s = sampleSelection()!;
    expect(s.x).toBe(12.3);
    expect(s.y).toBe(-5);
    expect(s.z).toBeNull();
    expect(s.rot).toBeCloseTo(30, 1);
    expect(s.tilt).toBeNull();
  });

  // 2*atan2(z, w) is the Z angle only while x and y are zero; for a posed transform
  // it reports a number that is none of its turns.
  it('a posed transform reports its depth and its other two turns', () => {
    transform({ x: 0, y: 0, z: -40 }, eulerToQuat([25, -15, 30]));
    useSelection.getState().select(7);
    const s = sampleSelection()!;
    expect(s.z).toBe(-40);
    expect(s.tilt).not.toBeNull();
    expect(s.tilt!.x).toBeCloseTo(25, 1);
    expect(s.tilt!.y).toBeCloseTo(-15, 1);
    expect(s.rot).toBeCloseTo(30, 1);
  });
});
