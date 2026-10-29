// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A Cocos `.anim` as an engine `.estimeline`.
 *
 * A clip is a list of tracks. Each names what it animates by a path (the nodes below the animated one, then a component, then a property) and
 * carries curves of keyframes. The timeline says the same: a track addresses a node by `childPath`, a component and a property, with a channel of
 * keys per number. A node's position, scale and a sprite's colour are numbers on both sides; a rotation is keyed as euler angles in Cocos and as a
 * quaternion here, so it is sampled; an `active` track becomes the ranges the node is active in. A track on something the timeline cannot reach is
 * counted, not dropped silently.
 */
type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export interface Key { time: number; value: number; inTangent: number; outTangent: number; interpolation: string }

export interface ConvertedClip {
    document: {
        version: string; type: 'timeline'; duration: number; wrapMode: 'once' | 'loop' | 'pingPong'; tracks: Raw[];
    };
    /** Tracks that could not be carried, by what they animated, with how many. */
    skipped: Map<string, number>;
    /** Whether the clip had events, which a timeline does not take from here. */
    events: number;
}

/** Cocos's `AnimationClip.WrapMode`: Loop (2, 22) and PingPong (36) are themselves, the rest play once. */
function wrapModeOf(mode: unknown): 'once' | 'loop' | 'pingPong' {
    return mode === 2 || mode === 22 ? 'loop' : mode === 36 ? 'pingPong' : 'once';
}

const INTERPOLATION = ['linear', 'step', 'hermite'];

/** One curve as keys. A value that is not an object (an older file) is a number on a straight line. */
function curveKeys(d: unknown[], curveRef: unknown, scale = 1): Key[] {
    const curve = deref(d, curveRef);
    if (!isObj(curve)) return [];
    const times = Array.isArray(curve._times) ? (curve._times as unknown[]) : [];
    const values = Array.isArray(curve._values) ? (curve._values as unknown[]) : [];
    const keys: Key[] = [];
    for (let i = 0; i < Math.min(times.length, values.length); i++) {
        const v = deref(d, values[i]);
        const time = num(times[i], 0);
        if (isObj(v)) {
            keys.push({
                time, value: num(v.value, 0) * scale, inTangent: num(v.leftTangent, 0) * scale, outTangent: num(v.rightTangent, 0) * scale,
                interpolation: INTERPOLATION[num(v.interpolationMode, 0)] ?? 'linear',
            });
        } else if (typeof v === 'number') {
            keys.push({ time, value: v * scale, inTangent: 0, outTangent: 0, interpolation: 'linear' });
        }
    }
    return keys;
}

function deref(d: unknown[], v: unknown): unknown {
    return isObj(v) && typeof v.__id__ === 'number' ? d[v.__id__] : v;
}

/** A curve's value at @p t, straight between keys and held by a step key. */
function sample(keys: Key[], t: number): number {
    if (keys.length === 0) return 0;
    if (t <= keys[0]!.time) return keys[0]!.value;
    const last = keys[keys.length - 1]!;
    if (t >= last.time) return last.value;
    for (let i = 1; i < keys.length; i++) {
        const b = keys[i]!;
        if (t <= b.time) {
            const a = keys[i - 1]!;
            if (a.interpolation === 'step') return a.value;
            const f = b.time === a.time ? 0 : (t - a.time) / (b.time - a.time);
            return a.value + (b.value - a.value) * f;
        }
    }
    return last.value;
}

/** Euler degrees as a quaternion (x, y, z, w), by Cocos's own `Quat.fromEuler`. */
function quatFromEuler(xDeg: number, yDeg: number, zDeg: number): [number, number, number, number] {
    const r = Math.PI / 360;
    const x = xDeg * r, y = yDeg * r, z = zDeg * r;
    const sx = Math.sin(x), cx = Math.cos(x), sy = Math.sin(y), cy = Math.cos(y), sz = Math.sin(z), cz = Math.cos(z);
    return [sx * cy * cz + cx * sy * sz, cx * sy * cz + sx * cy * sz, cx * cy * sz - sx * sy * cz, cx * cy * cz - sx * sy * sz];
}

/** The times to sample a rotation at: every key of any axis, and a step between them so a turn is not cut across by a straight line. */
function sampleTimes(curves: Key[][], duration: number): number[] {
    const times = new Set<number>();
    for (const keys of curves) for (const k of keys) times.add(k.time);
    const sorted = [...times].sort((a, b) => a - b);
    const out = new Set<number>(sorted);
    for (let i = 1; i < sorted.length; i++) {
        const span = sorted[i]! - sorted[i - 1]!;
        const steps = Math.min(30, Math.ceil(span * 30));
        for (let s = 1; s < steps; s++) out.add(sorted[i - 1]! + (span * s) / steps);
    }
    if (sorted.length === 0 && duration > 0) out.add(0);
    return [...out].sort((a, b) => a - b);
}

interface Target {
    /** Names of the nodes below the animated one, joined by `/`. */
    childPath: string;
    /** The component the property is on (`cc.Sprite`), or null for the node itself. */
    component: string | null;
    property: string;
}

function targetOf(d: unknown[], binding: unknown): Target | null {
    const b = deref(d, binding);
    if (!isObj(b)) return null;
    const path = deref(d, b.path);
    if (!isObj(path) || !Array.isArray(path._paths)) return null;
    const names: string[] = [];
    let component: string | null = null;
    let property = '';
    for (const raw of path._paths as unknown[]) {
        const p = deref(d, raw);
        if (typeof p === 'string') {
            property = p;
        } else if (isObj(p) && typeof p.path === 'string') {
            names.push(...p.path.split('/').filter(Boolean));   // a HierarchyPath
        } else if (isObj(p) && typeof p.component === 'string') {
            component = p.component;
        }
    }
    return property ? { childPath: names.join('/'), component, property } : null;
}

const COMPONENT_OF: Record<string, { component: string; property: string; scale: number } | undefined> = {
    'cc.Sprite.color': { component: 'Sprite', property: 'color', scale: 1 / 255 },
    'cc.Label.color': { component: 'Text', property: 'color', scale: 1 / 255 },
    'cc.UIOpacity.opacity': { component: 'GroupOpacity', property: 'opacity', scale: 1 / 255 },
};

const channelNames = (property: string, n: number): string[] => ['x', 'y', 'z', 'w'].slice(0, n).map((c) => `${property}.${c}`);

/** Convert the objects of a `.anim` file. */
export function convertAnimationClip(objects: unknown): ConvertedClip {
    const skipped = new Map<string, number>();
    const skip = (what: string): void => { skipped.set(what, (skipped.get(what) ?? 0) + 1); };
    const empty: ConvertedClip = { document: { version: '1.3', type: 'timeline', duration: 0, wrapMode: 'once', tracks: [] }, skipped, events: 0 };
    const d = Array.isArray(objects) ? objects : [objects];
    const clip = d[0];
    if (!isObj(clip)) return empty;
    const duration = num(clip._duration, 0);
    const tracks: Raw[] = [];
    for (const ref of Array.isArray(clip._tracks) ? (clip._tracks as unknown[]) : []) {
        const track = deref(d, ref);
        if (!isObj(track)) continue;
        const target = targetOf(d, track._binding);
        if (!target) { skip('unreadable'); continue; }
        const channels = (Array.isArray(track._channels) ? (track._channels as unknown[]) : track._channel ? [track._channel] : [])
            .map((c) => { const ch = deref(d, c); return isObj(ch) ? ch._curve : undefined; });
        const name = target.childPath.split('/').pop() ?? '';
        const kind = String(track.__type__ ?? '');

        if (target.component === null && (target.property === 'position' || target.property === 'scale') && kind.endsWith('VectorTrack')) {
            const props = channelNames(target.property, 3);
            const out = props.map((property, i) => ({ property, keyframes: curveKeys(d, channels[i]) })).filter((c) => c.keyframes.length > 0);
            if (out.length > 0) tracks.push({ type: 'property', name, childPath: target.childPath, component: 'Transform', channels: out });
            continue;
        }
        if (target.component === null && target.property === 'eulerAngles' && kind.endsWith('VectorTrack')) {
            const curves = [0, 1, 2].map((i) => curveKeys(d, channels[i]));
            const times = sampleTimes(curves, duration);
            if (times.length === 0) continue;
            const quats = times.map((t) => quatFromEuler(sample(curves[0]!, t), sample(curves[1]!, t), sample(curves[2]!, t)));
            const out = channelNames('rotation', 4).map((property, i) => ({
                property, keyframes: times.map((time, k) => ({ time, value: quats[k]![i]!, inTangent: 0, outTangent: 0, interpolation: 'linear' })),
            }));
            tracks.push({ type: 'property', name, childPath: target.childPath, component: 'Transform', channels: out });
            continue;
        }
        if (target.component === null && target.property === 'rotation' && kind.endsWith('QuatTrack')) {
            const out = channelNames('rotation', 4).map((property, i) => ({ property, keyframes: curveKeys(d, channels[i]) })).filter((c) => c.keyframes.length > 0);
            if (out.length > 0) tracks.push({ type: 'property', name, childPath: target.childPath, component: 'Transform', channels: out });
            continue;
        }
        const mapped = target.component ? COMPONENT_OF[`${target.component}.${target.property}`] : undefined;
        if (mapped && kind.endsWith('ColorTrack')) {
            const out = ['r', 'g', 'b', 'a'].map((c, i) => ({ property: `${mapped.property}.${c}`, keyframes: curveKeys(d, channels[i], mapped.scale) })).filter((c) => c.keyframes.length > 0);
            if (out.length > 0) tracks.push({ type: 'property', name, childPath: target.childPath, component: mapped.component, channels: out });
            continue;
        }
        if (mapped && kind.endsWith('RealTrack')) {
            const keyframes = curveKeys(d, channels[0], mapped.scale);
            if (keyframes.length > 0) tracks.push({ type: 'property', name, childPath: target.childPath, component: mapped.component, channels: [{ property: mapped.property, keyframes }] });
            continue;
        }
        if (target.component === null && target.property === 'active' && kind.endsWith('ObjectTrack')) {
            const curve = deref(d, channels[0]);
            const times = isObj(curve) && Array.isArray(curve._times) ? (curve._times as number[]) : [];
            const values = isObj(curve) && Array.isArray(curve._values) ? (curve._values as unknown[]) : [];
            const ranges: Array<{ start: number; end: number }> = [];
            let from: number | null = null;
            for (let i = 0; i < Math.min(times.length, values.length); i++) {
                const on = deref(d, values[i]) === true;
                if (on && from === null) from = times[i]!;
                if (!on && from !== null) { ranges.push({ start: from, end: times[i]! }); from = null; }
            }
            if (from !== null) ranges.push({ start: from, end: Math.max(duration, from) });
            if (ranges.length > 0) tracks.push({ type: 'activation', name, childPath: target.childPath, ranges });
            continue;
        }
        skip(`${target.component ?? 'node'}.${target.property}`);
    }
    return {
        document: { version: '1.3', type: 'timeline', duration, wrapMode: wrapModeOf(clip.wrapMode), tracks },
        skipped,
        events: Array.isArray(clip._events) ? clip._events.length : 0,
    };
}
