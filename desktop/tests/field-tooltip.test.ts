// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Inspector field metadata wiring — tooltip (UE ToolTip) and a DisplayName
 *        label override flow from a component's field metadata to the InspectorField
 *        the Details panel renders. Exercised through the user-schema path (no WASM).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setUserSchemas, inspectorFields } from '@/engine/schema';

beforeEach(() => {
  setUserSchemas([
    {
      name: 'Mover',
      default: { speed: 5, hp: 100 },
      colorKeys: [],
      fields: {
        speed: { tooltip: 'Units travelled per second', label: 'Move Speed', min: 0, max: 10 },
      },
    },
  ]);
});
afterEach(() => setUserSchemas([]));

describe('inspector field tooltip + DisplayName', () => {
  it('carries the tooltip and overrides the label', () => {
    const speed = inspectorFields('Mover', { speed: 5, hp: 100 }).find((f) => f.key === 'speed')!;
    expect(speed.tooltip).toBe('Units travelled per second');
    expect(speed.label).toBe('Move Speed'); // DisplayName override, not the key-derived 'Speed'
    expect(speed.min).toBe(0); // existing numeric metadata still flows
    expect(speed.max).toBe(10);
  });

  it('leaves fields without metadata on the key-derived label and no tooltip', () => {
    const hp = inspectorFields('Mover', { speed: 5, hp: 100 }).find((f) => f.key === 'hp')!;
    expect(hp.tooltip).toBeUndefined();
    expect(hp.label).not.toBe('Move Speed'); // default prettyLabel, not the override
  });

  it('flows an authored builtin tooltip end-to-end (Transform.position)', () => {
    const data = { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
    const pos = inspectorFields('Transform', data).find((f) => f.key === 'position')!;
    expect(typeof pos.tooltip).toBe('string');
    expect(pos.tooltip!.length).toBeGreaterThan(0);
  });
});
