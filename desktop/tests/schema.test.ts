// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Editor schema pure-function tests — establishes the desktop vitest
 *        harness and pins the inspector value-shape inference / conversions that
 *        the JSON-first rewrite (REARCH_SERIALIZATION.md) will lean on.
 */
import { describe, it, expect } from 'vitest';
import { prettyLabel, hexToRgba, angleZToQuat, inferField, assetFieldType, spineSlotType, isRenderComponent } from '@/engine/schema';

describe('prettyLabel', () => {
    it('splits camelCase and capitalizes', () => {
        expect(prettyLabel('orthoSize')).toBe('Ortho Size');
        expect(prettyLabel('position')).toBe('Position');
        expect(prettyLabel('isActive')).toBe('Is Active');
    });
    it('keeps acronyms and digit suffixes as words', () => {
        expect(prettyLabel('UIVisual')).toBe('UI Visual');
        expect(prettyLabel('Light2D')).toBe('Light 2D');
        expect(prettyLabel('ShadowCaster2D')).toBe('Shadow Caster 2D');
        expect(prettyLabel('BitmapText')).toBe('Bitmap Text');
    });
});

describe('hexToRgba', () => {
    it('parses #rrggbb into 0..1 channels (alpha defaults to 1)', () => {
        expect(hexToRgba('#ffffff')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
        expect(hexToRgba('#000000')).toEqual({ r: 0, g: 0, b: 0, a: 1 });
        const red = hexToRgba('#ff0000');
        expect([red.r, red.g, red.b, red.a]).toEqual([1, 0, 0, 1]);
    });
    it('parses the alpha byte of an #rrggbbaa hex', () => {
        expect(hexToRgba('#ff000000').a).toBe(0);
        expect(hexToRgba('#00ff00ff')).toEqual({ r: 0, g: 1, b: 0, a: 1 });
    });
    it('falls back to opaque white on malformed input', () => {
        expect(hexToRgba('nope')).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    });
});

describe('angleZToQuat', () => {
    it('round-trips 0° to identity', () => {
        const q = angleZToQuat(0);
        expect(q.x).toBe(0);
        expect(q.y).toBe(0);
        expect(q.z).toBeCloseTo(0, 6);
        expect(q.w).toBeCloseTo(1, 6);
    });
    it('encodes 90° into z/w', () => {
        const q = angleZToQuat(90);
        expect(q.z).toBeCloseTo(Math.SQRT1_2, 6);
        expect(q.w).toBeCloseTo(Math.SQRT1_2, 6);
    });
});

describe('inferField', () => {
    it('infers scalar/bool/string types from the live value', () => {
        expect(inferField('size', 5, false)).toMatchObject({ type: 'number', value: 5 });
        expect(inferField('flipX', true, false)).toMatchObject({ type: 'bool', value: true });
        expect(inferField('name', 'hi', false)).toMatchObject({ type: 'string', value: 'hi' });
    });
    it('infers vec2 / vec3 from object shape', () => {
        expect(inferField('p', { x: 1, y: 2 }, false)).toMatchObject({ type: 'vec2', value: [1, 2] });
        expect(inferField('p', { x: 1, y: 2, z: 3 }, false)).toMatchObject({ type: 'vec3', value: [1, 2, 3] });
    });
    it('treats a color key as an #rrggbbaa hex color', () => {
        const f = inferField('color', { r: 1, g: 0, b: 0, a: 1 }, true);
        expect(f?.type).toBe('color');
        expect(f?.value).toBe('#ff0000ff');
    });
    it('returns null for an unknown shape', () => {
        expect(inferField('weird', { foo: 1 }, false)).toBeNull();
    });
});

describe('spineSlotType', () => {
    it('maps the component def\'s compound spine descriptor to skeleton/atlas slots', () => {
        expect(spineSlotType('SpineAnimation', 'skeletonPath')).toBe('spine-skeleton');
        expect(spineSlotType('SpineAnimation', 'atlasPath')).toBe('spine-atlas');
    });
    it('is null for non-spine fields and non-spine components', () => {
        expect(spineSlotType('SpineAnimation', 'animation')).toBeNull();
        expect(spineSlotType('Sprite', 'texture')).toBeNull();
    });
    it('stays disjoint from assetFieldType — spine slots are path-valued, never handle-resolved', () => {
        expect(assetFieldType('SpineAnimation', 'skeletonPath')).toBeNull();
        expect(assetFieldType('SpineAnimation', 'atlasPath')).toBeNull();
        expect(assetFieldType('SpineAnimation', 'material')).toBe('material');
    });
});

describe('isRenderComponent', () => {
    // The eye's reach used to be a hand-kept list, and three renderables were
    // missing from it — so the set is derived from the engine schema (a component
    // that names a sorting layer is drawn) with only the unmarked ones listed.
    it('covers every component that names a sorting layer', () => {
        for (const name of [
            'Sprite', 'ShapeRenderer', 'SpineAnimation', 'DragonBonesAnimation',
            'TilemapLayer', 'ParticleEmitter', 'Mesh2D', 'TrailRenderer',
        ]) {
            expect(isRenderComponent(name), name).toBe(true);
        }
    });
    it('covers the ones the registry marks no layer on: UI text/visuals and lighting', () => {
        for (const name of ['BitmapText', 'UIVisual', 'Text', 'Light2D', 'ShadowCaster2D']) {
            expect(isRenderComponent(name), name).toBe(true);
        }
    });
    it('excludes behaviour components — disabling those is not hiding', () => {
        for (const name of [
            'Transform', 'Camera', 'RigidBody', 'BoxCollider', 'CircleCollider',
            'Interactable', 'UIScroll', 'UIMask', 'ParticleForceField', 'NotAComponent',
        ]) {
            expect(isRenderComponent(name), name).toBe(false);
        }
    });
});
