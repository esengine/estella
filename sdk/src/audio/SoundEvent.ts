// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { assetRefId, UUID_REF_PREFIX } from '../asset/AssetRegistry';
import { AttenuationModel, type SpatialAudioConfig } from './SpatialAudio';

/** Clip selection policy. Zero-weight slots are disabled in every mode. @beta */
export type SoundEventMode = 'random' | 'no-repeat' | 'sequence';
/** An authored audio reference and its relative weight. @beta */
export interface SoundEventClip { clip: string; weight: number }
/** Versioned `.esaudioevent` document shared by authoring and playback. @beta */
export interface SoundEventAsset {
    version: 1;
    clips: SoundEventClip[];
    mode: SoundEventMode;
    volume: [number, number];
    /** Playback rate changes both pitch and duration; this is not time stretching. */
    playbackRate: [number, number];
    bus: string;
    priority: number;
    /** 0 means unlimited. Pending loads and paused voices still own a slot. */
    maxInstances: number;
    /** Seconds on the consumer's simulation clock. */
    cooldown: number;
    spatial?: SpatialAudioConfig;
}

function object(value: unknown, path: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected an object`);
    return value as Record<string, unknown>;
}

function number(value: unknown, path: string, minimum: number, fallback?: number): number {
    if (value === undefined && fallback !== undefined) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
        throw new Error(`${path}: expected a finite number >= ${minimum}`);
    }
    return value;
}

function range(value: unknown, path: string, positive: boolean): [number, number] {
    if (value === undefined) return [1, 1];
    if (!Array.isArray(value) || value.length !== 2) throw new Error(`${path}: expected [min, max]`);
    const min = number(value[0], `${path}[0]`, 0), max = number(value[1], `${path}[1]`, min);
    if (positive && min <= 0) throw new Error(`${path}: playback rate must be positive`);
    return [min, max];
}

/** Validates the authored document with slot-specific errors; never drops a broken clip. @beta */
export function parseSoundEvent(value: unknown): SoundEventAsset {
    const raw = object(value, 'soundEvent');
    if (raw.version !== 1) throw new Error('soundEvent.version: expected 1');
    if (!Array.isArray(raw.clips)) throw new Error('soundEvent.clips: expected an array');
    const clips = raw.clips.map((value, i) => {
        const path = `soundEvent.clips[${i}]`, slot = object(value, path);
        if (typeof slot.clip !== 'string' || !slot.clip.trim()) throw new Error(`${path}.clip: expected an audio reference`);
        return { clip: slot.clip, weight: number(slot.weight, `${path}.weight`, 0, 1) };
    });
    const mode = raw.mode ?? 'no-repeat';
    if (mode !== 'random' && mode !== 'no-repeat' && mode !== 'sequence') throw new Error('soundEvent.mode: unknown selection mode');
    const bus = raw.bus ?? 'sfx';
    if (typeof bus !== 'string' || !bus.trim()) throw new Error('soundEvent.bus: expected a bus name');
    const maxInstances = number(raw.maxInstances, 'soundEvent.maxInstances', 0, 0);
    if (!Number.isSafeInteger(maxInstances)) throw new Error('soundEvent.maxInstances: expected a safe integer');
    const asset: SoundEventAsset = {
        version: 1, clips, mode, bus, maxInstances,
        volume: range(raw.volume, 'soundEvent.volume', false),
        playbackRate: range(raw.playbackRate, 'soundEvent.playbackRate', true),
        priority: number(raw.priority, 'soundEvent.priority', -Number.MAX_VALUE, 0),
        cooldown: number(raw.cooldown, 'soundEvent.cooldown', 0, 0),
    };
    if (raw.spatial !== undefined) {
        const spatial = object(raw.spatial, 'soundEvent.spatial');
        const model = spatial.model;
        if (model !== AttenuationModel.Linear && model !== AttenuationModel.Inverse && model !== AttenuationModel.Exponential) {
            throw new Error('soundEvent.spatial.model: unknown attenuation model');
        }
        const refDistance = number(spatial.refDistance, 'soundEvent.spatial.refDistance', Number.MIN_VALUE);
        asset.spatial = {
            model, refDistance,
            maxDistance: number(spatial.maxDistance, 'soundEvent.spatial.maxDistance', refDistance),
            rolloff: number(spatial.rolloff, 'soundEvent.spatial.rolloff', 0),
        };
    }
    return asset;
}

/** Selected authored slot and sampled playback parameters. @beta */
export interface SoundEventSelection { clip: string; slot: number; volume: number; playbackRate: number }
/** A selection or the reason no candidate can sound. @beta */
export type SoundEventSelectionResult = { selection: SoundEventSelection; reason?: never }
    | { selection: null; reason: 'empty' | 'zero-weight' };

interface Group { slot: number; weight: number; end: number; scale: number; sum: number }

/** Chance of drawing an authored slot next. A merged slot contributes its weight to the first enabled alias. @beta */
export interface SoundEventVariantShare {
    readonly share: number | null;
    readonly merged: boolean;
}

function clipIdentity(ref: string, identify?: (ref: string) => string | null): string {
    let name = ref;
    // Some play hosts throw for an absent manifest entry. Only selecting a missing clip should fail its load.
    try { name = identify?.(ref) ?? ref; } catch { /* group by the authored reference */ }
    const id = assetRefId(name);
    return id === null ? name : UUID_REF_PREFIX + id;
}

function scaledWeight(group: Group, scale: number): number {
    return (group.scale / scale) * group.sum;
}

/** Immutable compiled choices; selecting allocates no candidate lists or retained history.
 * Selection and parameter random streams are independent so range edits preserve clip order.
 * Duplicate clip identities combine weights in random modes; their first slot is reported.
 * The seed is reduced to 32 bits; only selection and sampled parameters are reproducible.
 * @beta */
export class SoundEventSelector {
    private readonly asset: SoundEventAsset;
    private readonly groups: Group[] = [];
    private readonly sequence: number[] = [];
    private total = 0;
    private cursor = 0;
    private last = -1;
    private choiceState: number;
    private parameterState: number;

    constructor(asset: SoundEventAsset, seed = 0, identifyClip?: (ref: string) => string | null) {
        this.asset = parseSoundEvent(asset);
        if (!Number.isSafeInteger(seed)) throw new Error('soundEvent.seed: expected a safe integer');
        this.choiceState = seed >>> 0; this.parameterState = (seed ^ 0x9e3779b9) >>> 0;
        let maximum = 0;
        for (const slot of this.asset.clips) maximum = Math.max(maximum, slot.weight);
        const byClip = new Map<string, Group>();
        for (let i = 0; i < this.asset.clips.length; ++i) {
            const slot = this.asset.clips[i];
            if (!slot.weight) continue;
            this.sequence.push(i);
            if (this.asset.mode === 'sequence') continue;
            const key = clipIdentity(slot.clip, identifyClip);
            let group = byClip.get(key);
            if (!group) { group = { slot: i, weight: 0, end: 0, scale: 0, sum: 0 }; byClip.set(key, group); this.groups.push(group); }
            if (slot.weight > group.scale) {
                group.sum = group.sum * (group.scale / slot.weight) + 1; group.scale = slot.weight;
            } else group.sum += slot.weight / group.scale;
        }
        for (const group of this.groups) {
            group.weight = scaledWeight(group, maximum);
            this.total += group.weight; group.end = this.total;
        }
    }

    /** Inspect the next draw without advancing the sequence or consuming random numbers. */
    getVariantShares(): SoundEventVariantShare[] {
        const sequential = this.asset.mode === 'sequence';
        const rows: SoundEventVariantShare[] = this.asset.clips.map(clip => ({ share: null, merged: !sequential && clip.weight > 0 }));
        if (sequential) {
            for (const slot of this.sequence) rows[slot] = { share: slot === this.sequence[this.cursor] ? 1 : 0, merged: false };
            return rows;
        }
        const excluded = this.excludedGroup();
        const remaining = excluded ? this.remainingWeights(excluded) : null;
        for (const group of this.groups) {
            let share = group.weight / this.total;
            if (group === excluded) share = 0;
            else if (remaining) share = scaledWeight(group, remaining.scale) / remaining.total;
            rows[group.slot] = { share, merged: false };
        }
        return rows;
    }

    private excludedGroup(): Group | undefined {
        return this.asset.mode === 'no-repeat' && this.groups.length > 1 ? this.groups[this.last] : undefined;
    }

    next(): SoundEventSelectionResult {
        if (!this.sequence.length) return { selection: null, reason: this.asset.clips.length ? 'zero-weight' : 'empty' };
        let slot: number;
        if (this.asset.mode === 'sequence') {
            slot = this.sequence[this.cursor]; this.cursor = (this.cursor + 1) % this.sequence.length;
        } else {
            const excluded = this.excludedGroup();
            const unit = this.random(false), remaining = this.total - (excluded?.weight ?? 0);
            let lo: number;
            if (excluded && remaining <= this.total * Number.EPSILON * 8) lo = this.sampleWithoutLast(unit, excluded);
            else {
                let point = unit * remaining;
                if (excluded && point >= excluded.end - excluded.weight) point += excluded.weight;
                lo = 0; let hi = this.groups.length - 1;
                while (lo < hi) { const mid = (lo + hi) >>> 1; if (point < this.groups[mid].end) hi = mid; else lo = mid + 1; }
                if (excluded && lo === this.last) lo = this.sampleWithoutLast(unit, excluded);
            }
            this.last = lo; slot = this.groups[lo].slot;
        }
        return { selection: { clip: this.asset.clips[slot].clip, slot,
            volume: this.sampleRange(this.asset.volume), playbackRate: this.sampleRange(this.asset.playbackRate) } };
    }

    /** Rescale after excluding a dominant weight so subtraction cannot erase the remaining choices. */
    private remainingWeights(excluded: Group): { scale: number; total: number } {
        let scale = 0, total = 0;
        for (const group of this.groups) if (group !== excluded) scale = Math.max(scale, group.scale);
        for (const group of this.groups) if (group !== excluded) total += scaledWeight(group, scale);
        return { scale, total };
    }

    private sampleWithoutLast(unit: number, excluded: Group): number {
        const { scale, total } = this.remainingWeights(excluded);
        let fallback = 0;
        let point = unit * total;
        for (let i = 0; i < this.groups.length; ++i) {
            if (this.groups[i] === excluded) continue;
            fallback = i;
            point -= scaledWeight(this.groups[i], scale);
            if (point < 0) return i;
        }
        return fallback;
    }

    private sampleRange(bounds: [number, number]): number {
        const unit = this.random(true);
        return Math.min(bounds[1], Math.max(bounds[0], bounds[0] * (1 - unit) + bounds[1] * unit));
    }

    private random(parameter: boolean): number {
        const state = ((parameter ? this.parameterState : this.choiceState) + 0x6d2b79f5) | 0;
        if (parameter) this.parameterState = state; else this.choiceState = state;
        let value = Math.imul(state ^ (state >>> 15), state | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    }
}
