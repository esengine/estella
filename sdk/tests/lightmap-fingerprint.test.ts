// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Whether a scene has moved on since it was lit. The claim is two-sided: every
 * value a bake reads has to change the fingerprint, and nothing a bake ignores
 * may — otherwise "out of date" is either a nag or a lie.
 */
import { describe, it, expect } from 'vitest';
import { bakeFingerprint, type BakeInputs } from '../src/lightmap';

const BASE: BakeInputs = {
    surfaces: [
        { mesh: 'assets/floor.esmesh', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
          albedo: [0.5, 0.5, 0.5], texture: 'assets/wood.png', holdsStill: true },
        { mesh: 'builtin:cube', transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1],
          holdsStill: false },
    ],
    lights: [
        { kind: 'directional', direction: [0, -1, 0], color: [1, 1, 1], intensity: 1 },
    ],
    volumes: [{ center: [0, 0, 0], halfExtents: [100, 100, 100], spacing: 50 }],
    ambient: [0.1, 0.2, 0.3],
    options: { atlasSize: 512, texelsPerUnit: 0.25, bounces: 2, samples: 64, probeSamples: 128 },
};

/** BASE as something an edit can reach into: the same shape without the readonly
 *  tuples, which a caller authoring a change does not have to satisfy. */
interface Draft {
    surfaces: Array<{
        mesh: string; transform: number[]; albedo?: number[]; texture?: string;
        holdsStill?: boolean;
    }>;
    lights: Array<{
        kind: string; position?: number[]; direction?: number[]; color: number[];
        intensity: number; radius?: number; innerCos?: number; outerCos?: number;
    }>;
    volumes: Array<{ center: number[]; halfExtents: number[]; spacing: number }>;
    ambient?: number[];
    options?: Record<string, number>;
}

/** BASE with one value replaced, as a caller would author the change. */
function changed(edit: (draft: Draft) => void): BakeInputs {
    const draft = JSON.parse(JSON.stringify(BASE)) as Draft;
    edit(draft);
    return draft as unknown as BakeInputs;
}

describe('a bake fingerprint', () => {
    it('is the same for the same inputs', () => {
        expect(bakeFingerprint(BASE)).toBe(bakeFingerprint(BASE));
        expect(bakeFingerprint(changed(() => {}))).toBe(bakeFingerprint(BASE));
    });

    it('does not depend on the order things were collected in', () => {
        // The document collector and the world collector walk their sources
        // differently, and a scene whose entities were reordered is the same
        // scene to light. If order counted, the two would disagree forever.
        const reversed = changed((d) => {
            d.surfaces = [...d.surfaces].reverse();
            d.lights = [...d.lights].reverse();
        });
        expect(bakeFingerprint(reversed)).toBe(bakeFingerprint(BASE));
    });

    it('changes for every value a bake actually reads', () => {
        const edits: Array<[string, (d: Draft) => void]> = [
            ['a mesh was swapped', (d) => { d.surfaces[0]!.mesh = 'assets/wall.esmesh'; }],
            ['something moved', (d) => { d.surfaces[0]!.transform[13] = 5; }],
            ['an albedo changed', (d) => { d.surfaces[0]!.albedo = [1, 0, 0]; }],
            ['a texture changed', (d) => { d.surfaces[0]!.texture = 'assets/tile.png'; }],
            ['something started moving', (d) => { d.surfaces[0]!.holdsStill = false; }],
            ['a light turned', (d) => { d.lights[0]!.direction = [1, -1, 0]; }],
            ['a light brightened', (d) => { d.lights[0]!.intensity = 2; }],
            ['a light was added', (d) => { d.lights.push({ kind: 'point', position: [0, 5, 0], color: [1, 1, 1], intensity: 3, radius: 20 }); }],
            ['a volume moved', (d) => { d.volumes[0]!.center = [0, 50, 0]; }],
            ['a volume was resized', (d) => { d.volumes[0]!.halfExtents = [200, 100, 100]; }],
            ['its density changed', (d) => { d.volumes[0]!.spacing = 25; }],
            ['the ambient changed', (d) => { d.ambient = [0, 0, 0]; }],
            ['the atlas was resized', (d) => { d.options = { ...d.options, atlasSize: 1024 }; }],
            ['the density changed', (d) => { d.options = { ...d.options, texelsPerUnit: 0.5 }; }],
            ['the bounces changed', (d) => { d.options = { ...d.options, bounces: 0 }; }],
            ['the samples changed', (d) => { d.options = { ...d.options, samples: 128 }; }],
            ['the probe samples changed', (d) => { d.options = { ...d.options, probeSamples: 64 }; }],
        ];
        const base = bakeFingerprint(BASE);
        for (const [what, edit] of edits) {
            expect(bakeFingerprint(changed(edit)), `${what}: the fingerprint did not move`)
                .not.toBe(base);
        }
    });

    it('fills an absent option from the same defaults a bake would', () => {
        // A scene that never set a knob and one that set it to the default are
        // the same bake, so they must fingerprint alike — otherwise adding the
        // component to a lit scene would report it out of date.
        const stated = changed((d) => { d.options = { ...d.options, dilate: 2 }; });
        const unstated = changed((d) => { delete d.options?.dilate; });
        expect(bakeFingerprint(stated)).toBe(bakeFingerprint(unstated));
    });
});
