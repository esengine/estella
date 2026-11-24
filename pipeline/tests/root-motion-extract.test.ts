// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The claim: taking a clip's ground travel out of its top joint changes nothing about where anything is — the root track
 * and what the joint keeps add up to what the joint did — and a clip that goes nowhere is left as it was.
 */
import { describe, expect, it } from 'vitest';
import { extractRootMotion } from '../src/assets/rootMotionExtract';
import { trimClipLeadIn, type ImportedNode } from '../src/assets/modelImport';

const key = (time: number, value: number) => ({ time, value, inTangent: 0, outTangent: 0, interpolation: 'linear' });

const node = (name: string, children: ImportedNode[] = [], over: Partial<ImportedNode> = {}): ImportedNode => ({
    index: 0, name, translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], meshes: [], children, ...over,
});

interface Doc {
    duration: number;
    tracks: {
        type: string; name: string; childPath: string; component: string;
        channels: { property: string; keyframes: { time: number; value: number }[] }[];
    }[];
}

/** A walk whose hips go `forward` along +Z over a second, bobbing and swaying on the way. */
function walk(forward: number, start = 0): Doc & Record<string, unknown> {
    const times = [0, 0.25, 0.5, 0.75, 1].map((t) => t + start);
    return {
        version: '1.3', type: 'timeline', duration: 1 + start, wrapMode: 'once',
        tracks: [{
            type: 'property', name: 'Hips', childPath: 'Hips', component: 'Transform',
            channels: [
                { property: 'position.x', keyframes: times.map((t, i) => key(t, [0, 0.02, 0, -0.02, 0][i]!)) },
                { property: 'position.y', keyframes: times.map((t, i) => key(t, [1, 1.03, 1, 1.03, 1][i]!)) },
                { property: 'position.z', keyframes: times.map((t, i) => key(t, forward * [0, 0.3, 0.5, 0.8, 1][i]!)) },
            ],
        }, {
            type: 'property', name: 'Spine', childPath: 'Hips/Spine', component: 'Transform',
            channels: [{ property: 'rotation.x', keyframes: [key(start, 0), key(1 + start, 0)] }],
        }],
    };
}

const channel = (doc: Doc, path: string, property: string) =>
    doc.tracks.find((t) => t.childPath === path)!.channels.find((c) => c.property === property)!.keyframes;

const at = (keys: { time: number; value: number }[], time: number): number => {
    const next = keys.findIndex((k) => k.time >= time);
    if (next <= 0) return keys[Math.max(next, 0)]!.value;
    const a = keys[next - 1]!, b = keys[next]!;
    return a.value + (b.value - a.value) * (time - a.time) / (b.time - a.time);
};

const rig = () => [node('Armature', [node('Hips', [node('Spine')])])];

describe('a walk that keeps its travel in the hips', () => {
    it('gets a root track that covers the distance at a steady rate', () => {
        const doc = walk(2);
        const taken = extractRootMotion(doc, rig());
        expect(taken).toMatchObject({ joint: 'Hips', seconds: 1 });
        expect((taken as { distance: number }).distance).toBeCloseTo(2, 6);
        expect(channel(doc, '', 'position.z').map((k) => [k.time, k.value])).toEqual([[0, 0], [1, 2]]);
    });

    it('and the two together are where the hips were', () => {
        const before = walk(2);
        const doc = walk(2);
        extractRootMotion(doc, rig());
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
            for (const axis of ['x', 'y', 'z']) {
                const whole = at(channel(doc, '', `position.${axis}`), t) + at(channel(doc, 'Hips', `position.${axis}`), t);
                expect(whole).toBeCloseTo(at(channel(before, 'Hips', `position.${axis}`), t), 6);
            }
        }
    });

    it('leaves the hips where they began, so the loop closes', () => {
        const doc = walk(2);
        extractRootMotion(doc, rig());
        const z = channel(doc, 'Hips', 'position.z');
        expect(z[z.length - 1]!.value).toBeCloseTo(z[0]!.value, 6);
    });

    it('keeps the rise with the joint: over the ground only', () => {
        const doc = walk(2);
        channel(doc, 'Hips', 'position.y')[4]!.value = 1.5;
        extractRootMotion(doc, rig());
        expect(channel(doc, '', 'position.y').every((k) => Math.abs(k.value) < 1e-9)).toBe(true);
        expect(channel(doc, 'Hips', 'position.y')[4]!.value).toBeCloseTo(1.5, 6);
    });

    it('states the travel in the axes of the root through a node standing between them', () => {
        const doc = walk(2);
        for (const track of doc.tracks) track.childPath = `Rig/${track.childPath}`;
        // A holder that doubles the skeleton: two units of the hips are four of the root.
        const taken = extractRootMotion(doc, [
            node('Armature', [node('Rig', [node('Hips', [node('Spine')])], { scale: [2, 2, 2] })]),
        ]);
        expect((taken as { distance: number }).distance).toBeCloseTo(4, 6);
        const z = channel(doc, 'Rig/Hips', 'position.z');
        expect(z[z.length - 1]!.value).toBeCloseTo(z[0]!.value, 6);
    });
});

describe('a clip the extraction leaves alone', () => {
    it('one that ends where it began', () => {
        const doc = walk(0);
        expect(extractRootMotion(doc, rig())).toBeNull();
        expect(doc.tracks.some((t) => t.childPath === '')).toBe(false);
    });

    it('one that already says where its root goes', () => {
        const doc = walk(2);
        doc.tracks.unshift({
            type: 'property', name: 'root', childPath: '', component: 'Transform',
            channels: [{ property: 'position.z', keyframes: [key(0, 0), key(1, 2)] }],
        });
        expect(extractRootMotion(doc, rig())).toBeNull();
        expect(channel(doc, 'Hips', 'position.z')[4]!.value).toBe(2);
    });

    it('one whose joint hangs under something animated, with the reason', () => {
        const doc = walk(2);
        for (const track of doc.tracks) track.childPath = `Rig/${track.childPath}`;
        doc.tracks.push({
            type: 'property', name: 'Rig', childPath: 'Rig', component: 'Transform',
            channels: [{ property: 'rotation.y', keyframes: [key(0, 0), key(1, 1)] }],
        });
        expect(extractRootMotion(doc, [node('Armature', [node('Rig', [node('Hips')])])])).toMatch(/is animated too/);
    });
});

describe('a clip exported from a timeline that starts a frame in', () => {
    it('begins at its first key', () => {
        const doc = walk(2, 1 / 24);
        expect(trimClipLeadIn(doc)).toBeCloseTo(1 / 24, 9);
        expect(doc.duration).toBeCloseTo(1, 9);
        expect(channel(doc, 'Hips', 'position.z')[0]!.time).toBeCloseTo(0, 9);
        expect(channel(doc, 'Hips/Spine', 'rotation.x')[1]!.time).toBeCloseTo(1, 9);
    });

    it('and one that starts at zero is not touched', () => {
        const doc = walk(2);
        expect(trimClipLeadIn(doc)).toBe(0);
        expect(doc.duration).toBe(1);
    });
});

describe('a clip whose pace changes, taken along its own course', () => {
    /** A run that brakes: the hips go 0, 1.2, 2, 2.4, 2.5 along +Z over a second. */
    const stop = (): Doc & Record<string, unknown> => {
        const doc = walk(0);
        const z = channel(doc, 'Hips', 'position.z');
        [0, 1.2, 2, 2.4, 2.5].forEach((v, i) => { z[i]!.value = v; });
        return doc;
    };

    it('gives the root the joint\'s course key by key, not a steady rate', () => {
        const doc = stop();
        expect(extractRootMotion(doc, rig(), 'path')).toMatchObject({ joint: 'Hips' });
        expect(channel(doc, '', 'position.z').map((k) => k.value)).toEqual([0, 1.2, 2, 2.4, 2.5]);
    });

    it('leaves the joint its height and nothing of the travel', () => {
        const doc = stop();
        extractRootMotion(doc, rig(), 'path');
        expect(channel(doc, 'Hips', 'position.z').every((k) => Math.abs(k.value) < 1e-9)).toBe(true);
        expect(channel(doc, 'Hips', 'position.y').map((k) => k.value)).toEqual([1, 1.03, 1, 1.03, 1]);
    });
});
