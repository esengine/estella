// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Editor schema pure-function tests — establishes the desktop vitest
 *        harness and pins the inspector value-shape inference / conversions that
 *        the JSON-first rewrite (REARCH_SERIALIZATION.md) will lean on.
 */
import { describe, it, expect } from 'vitest';
import { prettyLabel, hexToRgba, eulerToQuat, quatToEuler, setAngleZ, inferField, assetFieldType, spineSlotType, isRenderComponent } from '@/engine/schema';

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

describe('a rotation as three degrees', () => {
    it('is the 2D quaternion exactly when only Z turns', () => {
        // The 2D case has to come out of the general one unchanged, or every
        // existing scene shifts the day the other two axes become editable.
        const q = eulerToQuat([0, 0, 90]);
        expect(q.x).toBeCloseTo(0, 12);
        expect(q.y).toBeCloseTo(0, 12);
        expect(q.z).toBeCloseTo(Math.SQRT1_2, 12);
        expect(q.w).toBeCloseTo(Math.SQRT1_2, 12);
        expect(quatToEuler(q)).toEqual([0, 0, 90]);
    });

    it('round-trips a pose that turns about all three', () => {
        for (const e of [[0, 0, 0], [30, -45, 60], [-12.5, 80, 175], [0, 45, 0]]) {
            const back = quatToEuler(eulerToQuat(e));
            back.forEach((v, i) => expect(v).toBeCloseTo(e[i]!, 2));
        }
    });

    it('keeps the other two axes when only the Z turn is set', () => {
        // What the viewport's rotate gizmo writes. Zeroing X and Y here is how a
        // model imported with a 3D pose got flattened by a drag.
        const posed = eulerToQuat([30, -45, 10]);
        const turned = quatToEuler(setAngleZ(posed, 90));
        expect(turned[0]).toBeCloseTo(30, 2);
        expect(turned[1]).toBeCloseTo(-45, 2);
        expect(turned[2]).toBeCloseTo(90, 2);
    });

    it('charges a pole to Z, so a 2D turn survives one', () => {
        const [x, y, z] = quatToEuler(eulerToQuat([0, 90, 35]));
        expect(x).toBe(0);
        expect(y).toBeCloseTo(90, 2);
        expect(z).toBeCloseTo(35, 2);
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
    // The eye reaches what each component DECLARES (`renderable=<field>` at its
    // ES_COMPONENT site, `renderableField` for a TS-defined one) — not a list the
    // editor keeps, which would drift from the runtime's answer.
    it('covers every renderer, scene-space and UI', () => {
        for (const name of [
            'Sprite', 'ShapeRenderer', 'SpineAnimation', 'DragonBonesAnimation',
            'TilemapLayer', 'ParticleEmitter', 'Mesh2D', 'TrailRenderer',
            'BitmapText', 'UIVisual', 'Text',
        ]) {
            expect(isRenderComponent(name), name).toBe(true);
        }
    });
    // Not drawn, but hiding an entity has to stop it lighting the scene too.
    it('covers lighting', () => {
        for (const name of ['Light2D', 'ShadowCaster2D']) {
            expect(isRenderComponent(name), name).toBe(true);
        }
    });
    it('excludes behaviour components — disabling those is not hiding', () => {
        for (const name of [
            'Transform', 'Camera', 'RigidBody', 'BoxCollider', 'CircleCollider',
            'Interactable', 'UIScroll', 'UIMask', 'ParticleForceField', 'NotAComponent',
            // Each carries an `enabled` / `visible` field that has nothing to do
            // with drawing — folding `Perception.visible` would corrupt what an AI
            // agent believes it sees. Hence declared, not sniffed off a field name.
            'Animator', 'SpriteAnimator', 'AudioSource', 'CacheAsBitmap', 'Perception',
            // Video's flag drives PLAYBACK; the frames are drawn by the sibling
            // Sprite / UIVisual / Mesh2D, which hides on its own declaration.
            'Video',
        ]) {
            expect(isRenderComponent(name), name).toBe(false);
        }
    });
});
