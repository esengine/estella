// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A rotation quaternion and a vec4 share the {x,y,z,w} shape, so the field
 *        inference must not surface a vec4 (Camera viewport rect, a 9-slice border)
 *        as a bogus rotation angle. Regression for `viewport` rendering as "90°"
 *        (atan2(z=1, w=1)·2 = 90°).
 */
import { describe, it, expect } from 'vitest';
import { inferField, inspectorFields, eulerToQuat } from '@/engine/schema';

describe('quaternion vs vec4 inference', () => {
  it('a rotation quaternion (w-first) reads as three degrees', () => {
    expect(inferField('rotation', { w: 1, x: 0, y: 0, z: 0 }, false)!.type).toBe('euler');
    // A user component quaternion (w-first layout) is caught even without the name.
    expect(inferField('orient', { w: 1, x: 0, y: 0, z: 0 }, false)!.type).toBe('euler');
  });

  it('a vec4 (x-first) reads as four numbers, not an angle', () => {
    const viewport = inferField('viewport', { x: 0, y: 0, z: 1, w: 1 }, false)!;
    expect(viewport.type).toBe('vec4');
    expect(viewport.value).toEqual([0, 0, 1, 1]); // NOT a rotation → not degrees
    const border = inferField('sliceBorder', { x: 4, y: 4, z: 4, w: 4 }, false)!;
    expect(border.type).toBe('vec4');
    expect(border.value).toEqual([4, 4, 4, 4]);
  });

  it("end-to-end: the Camera's viewport field is a vec4 in the inspector", () => {
    const viewport = inspectorFields('Camera', { projectionType: 1 }).find((f) => f.key === 'viewport');
    expect(viewport).toBeDefined();
    expect(viewport!.type).toBe('vec4');
    expect(viewport!.value).toEqual([0, 0, 1, 1]);
  });

  it('a user quaternion keeps its control after an EDIT (eulerToQuat is w-first)', () => {
    // Editing rewrites the field via eulerToQuat; if it emitted x-first, the next
    // inference would mis-classify the field as a vec4 and drop the control.
    const edited = eulerToQuat([0, 0, 45]);
    expect(Object.keys(edited)[0]).toBe('w'); // w-first layout preserved
    expect(inferField('orient', edited, false)!.type).toBe('euler');
  });

  it("end-to-end: the Transform's rotation is three degrees", () => {
    const data = { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
    const rot = inspectorFields('Transform', data).find((f) => f.key === 'rotation')!;
    expect(rot.type).toBe('euler');
    expect(rot.value).toEqual([0, 0, 0]);
  });
});
