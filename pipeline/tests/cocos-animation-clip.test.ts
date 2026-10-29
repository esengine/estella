// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos `.anim` as an engine timeline: what each kind of track becomes, and what is counted instead of lost.
 */
import { describe, expect, it } from 'vitest';
import { convertAnimationClip } from '../src/import/cocos/animationClip';

/** Build a `.anim`'s object list from tracks written as [binding path parts, track kind, curves]; ids are assigned as the list grows. */
function anim(tracks: Array<{ kind: string; path: unknown[]; curves: Array<{ times: number[]; values: unknown[] }> }>, over: Record<string, unknown> = {}): unknown[] {
    const objects: unknown[] = [];
    const add = (o: unknown): { __id__: number } => { objects.push(o); return { __id__: objects.length - 1 }; };
    const clip: Record<string, unknown> = { __type__: 'cc.AnimationClip', _name: 'clip', wrapMode: 1, _duration: 1, _tracks: [], _events: [], ...over };
    add(clip);
    const refs = tracks.map((t) => {
        const path = add({ __type__: 'cc.animation.TrackPath', _paths: t.path.map((p) => (typeof p === 'string' ? p : add(p))) });
        const channels = t.curves.map((c) => add({ __type__: 'cc.animation.Channel', _curve: add({ __type__: 'cc.RealCurve', _times: c.times, _values: c.values }) }));
        return add({ __type__: t.kind, _binding: { __type__: 'cc.animation.TrackBinding', path }, _channels: channels });
    });
    clip._tracks = refs;
    return objects;
}
const real = (value: number, extra: object = {}) => ({ __type__: 'cc.RealKeyframeValue', interpolationMode: 0, value, leftTangent: 0, rightTangent: 0, ...extra });
const hierarchy = (path: string) => ({ __type__: 'cc.animation.HierarchyPath', path });
const component = (name: string) => ({ __type__: 'cc.animation.ComponentPath', component: name });

describe('a Cocos animation clip', () => {
    it('moves a child node: position becomes the transform\'s three channels, under the child\'s path', () => {
        const { document } = convertAnimationClip(anim([{
            kind: 'cc.animation.VectorTrack', path: [hierarchy('body/arm'), 'position'],
            curves: [
                { times: [0, 1], values: [real(0), real(10)] }, { times: [0, 1], values: [real(5), real(5)] }, { times: [0, 1], values: [real(0), real(0)] },
            ],
        }]));
        expect(document.tracks).toHaveLength(1);
        const t = document.tracks[0] as any;
        expect([t.type, t.childPath, t.component]).toEqual(['property', 'body/arm', 'Transform']);
        expect(t.channels.map((c: any) => c.property)).toEqual(['position.x', 'position.y', 'position.z']);
        expect(t.channels[0].keyframes.map((k: any) => k.value)).toEqual([0, 10]);
    });

    it('fades a sprite: its colour keyed 0..255 becomes 0..1 on the Sprite', () => {
        const key = (v: number) => real(v);
        const curve = (a: number, b: number) => ({ times: [0, 1], values: [key(a), key(b)] });
        const { document } = convertAnimationClip(anim([{
            kind: 'cc.animation.ColorTrack', path: [component('cc.Sprite'), 'color'], curves: [curve(255, 255), curve(255, 255), curve(255, 255), curve(255, 0)],
        }]));
        const t = document.tracks[0] as any;
        expect([t.component, t.childPath]).toEqual(['Sprite', '']);
        expect(t.channels.map((c: any) => c.property)).toEqual(['color.r', 'color.g', 'color.b', 'color.a']);
        expect(t.channels[3].keyframes.map((k: any) => k.value)).toEqual([1, 0]);
    });

    it('turns a node about its Z: euler angles become the quaternion channels, sampled finely enough to follow the turn', () => {
        const { document } = convertAnimationClip(anim([{
            kind: 'cc.animation.VectorTrack', path: [hierarchy('wheel'), 'eulerAngles'],
            curves: [{ times: [0, 1], values: [real(0), real(0)] }, { times: [0, 1], values: [real(0), real(0)] }, { times: [0, 1], values: [real(0), real(180)] }],
        }]));
        const t = document.tracks[0] as any;
        expect(t.channels.map((c: any) => c.property)).toEqual(['rotation.x', 'rotation.y', 'rotation.z', 'rotation.w']);
        const z = t.channels[2].keyframes;
        const w = t.channels[3].keyframes;
        expect(z.length).toBeGreaterThan(10);
        expect(z[0].value).toBeCloseTo(0, 5);
        expect(z[z.length - 1].value).toBeCloseTo(1, 5);       // 180 degrees about Z: (0, 0, 1, 0)
        expect(w[w.length - 1].value).toBeCloseTo(0, 5);
        const mid = Math.floor(z.length / 2);
        expect(Math.hypot(z[mid].value, w[mid].value)).toBeCloseTo(1, 2);   // still a rotation half-way
    });

    it('turns an active track into the ranges the node is on in', () => {
        const { document } = convertAnimationClip(anim([{
            kind: 'cc.animation.ObjectTrack', path: [hierarchy('flash'), 'active'], curves: [{ times: [0, 0.25, 0.5], values: [false, true, false] }],
        }]));
        expect(document.tracks[0]).toMatchObject({ type: 'activation', childPath: 'flash', ranges: [{ start: 0.25, end: 0.5 }] });
    });

    it('keeps the key\'s curve: held, straight, or with its tangents', () => {
        const { document } = convertAnimationClip(anim([{
            kind: 'cc.animation.VectorTrack', path: ['scale'],
            curves: [{ times: [0, 1, 2], values: [real(1, { interpolationMode: 1 }), real(2, { interpolationMode: 2, leftTangent: 3, rightTangent: 4 }), real(3)] },
                { times: [0], values: [real(1)] }, { times: [0], values: [real(1)] }],
        }], { _duration: 2 }));
        const keys = (document.tracks[0] as any).channels[0].keyframes;
        expect(keys.map((k: any) => k.interpolation)).toEqual(['step', 'hermite', 'linear']);
        expect([keys[1].inTangent, keys[1].outTangent]).toEqual([3, 4]);
    });

    it('plays once, loops or ping-pongs as the clip says, and counts what it cannot carry', () => {
        expect(convertAnimationClip(anim([], { wrapMode: 2 })).document.wrapMode).toBe('loop');
        expect(convertAnimationClip(anim([], { wrapMode: 36 })).document.wrapMode).toBe('pingPong');
        expect(convertAnimationClip(anim([], { wrapMode: 1 })).document.wrapMode).toBe('once');
        const clip = convertAnimationClip(anim([{
            kind: 'cc.animation.RealTrack', path: [component('cc.ParticleSystem'), 'material'], curves: [{ times: [0], values: [real(1)] }],
        }], { _events: [{}, {}] }));
        expect(clip.document.tracks).toEqual([]);
        expect(clip.skipped.get('cc.ParticleSystem.material')).toBe(1);
        expect(clip.events).toBe(2);
    });
});

describe('what the engine reads of it', () => {
    it('parses every kind of track written here with the timeline loader the runtime uses', async () => {
        const path = await import('node:path');
        const { parseTimelineAsset } = await import(/* @vite-ignore */ path.resolve(__dirname, '../../sdk/src/timeline/TimelineLoader.ts'));
        const curve = (v: number[]) => ({ times: v.map((_, i) => i), values: v.map((x) => real(x)) });
        const clip = convertAnimationClip(anim([
            { kind: 'cc.animation.VectorTrack', path: [hierarchy('a'), 'position'], curves: [curve([0, 1]), curve([0, 1]), curve([0, 0])] },
            { kind: 'cc.animation.VectorTrack', path: [hierarchy('a'), 'eulerAngles'], curves: [curve([0, 0]), curve([0, 0]), curve([0, 90])] },
            { kind: 'cc.animation.ColorTrack', path: [component('cc.Sprite'), 'color'], curves: [curve([255, 0]), curve([255, 0]), curve([255, 0]), curve([255, 0])] },
            { kind: 'cc.animation.RealTrack', path: [component('cc.UIOpacity'), 'opacity'], curves: [curve([255, 0])] },
            { kind: 'cc.animation.ObjectTrack', path: [hierarchy('b'), 'active'], curves: [{ times: [0, 1], values: [true, false] }] },
        ], { wrapMode: 2 }));
        const asset = parseTimelineAsset(clip.document);
        expect(asset.tracks.map((t: any) => t.type)).toEqual(['property', 'property', 'property', 'property', 'activation']);
        expect(asset.wrapMode).toBeDefined();
    });
});
