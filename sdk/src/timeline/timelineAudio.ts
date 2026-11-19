// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineAudio.ts
 * @brief   Audio clips on a timeline: heard while the playhead is inside them, faded, paused and joined in the middle.
 *
 * @details A sound with a `duration` (see AudioEvent) is a clip, as in Unity's Timeline and UE's Sequencer, and is not
 *          fired once like a moment: it is a voice kept for as long as the playhead is inside it. Each frame the voices
 *          a player should have are compared with the ones it has. One that should start does, from where the playhead
 *          is in it (so landing in the middle of a line of dialogue plays the rest of it); one whose clip the playhead
 *          has left stops; the rest are faded to where their fade in and out say. A paused timeline pauses its voices,
 *          and a playhead that jumps (a seek, a loop back) starts them again at the new place.
 */
import { TrackType, type AudioEvent, type TimelineAsset } from './TimelineTypes';
import type { AudioAPI } from '../audio/Audio';
import type { AudioHandle } from '../audio/PlatformAudioBackend';
import type { Entity } from '../types';

/** Whether an audio item is a clip (heard over a span) rather than a moment. */
export const isAudioClip = (e: AudioEvent): boolean => (e.duration ?? 0) > 0;

/** How loud a clip is at track time `time`, 0 to 1: its fade in from its start, its fade out to its end. */
export function audioClipGain(e: AudioEvent, time: number): number {
    const d = e.duration ?? 0;
    if (d <= 0 || time < e.time || time >= e.time + d) return 0;
    const into = time - e.time, left = e.time + d - time;
    const fi = e.fadeIn ?? 0, fo = e.fadeOut ?? 0;
    const up = fi > 0 ? Math.min(1, into / fi) : 1;
    const down = fo > 0 ? Math.min(1, left / fo) : 1;
    return Math.max(0, Math.min(up, down));
}

/** Seconds into the sound at track time `time` (before any looping, which the voice does itself). */
export const audioClipOffset = (e: AudioEvent, time: number): number => (e.clipIn ?? 0) + Math.max(0, time - e.time);

interface Voice {
    handle: AudioHandle;
    paused: boolean;
}

/** A playhead step longer than this, or backwards, is a jump: voices start again where it landed. */
const JUMP = 0.25;

/** The audio clips of every playing timeline, by player. */
export class TimelineAudioVoices {
    private readonly voices_ = new Map<Entity, Map<string, Voice>>();
    private readonly last_ = new Map<Entity, number>();

    /**
     * Brings `player`'s voices in line with `asset` at `time`. `playing` false pauses them where they are; `audio`
     * null (no audio in this build) does nothing.
     */
    sync(player: Entity, asset: TimelineAsset, time: number, playing: boolean, audio: AudioAPI | null): void {
        if (!audio) return;
        let voices = this.voices_.get(player);
        const last = this.last_.get(player);
        this.last_.set(player, time);
        const jumped = last !== undefined && (time < last - 1e-6 || time - last > JUMP);
        const want = new Set<string>();
        asset.tracks.forEach((track, ti) => {
            if (track.type !== TrackType.Audio) return;
            track.events.forEach((e, ei) => {
                if (!isAudioClip(e) || !e.clip) return;
                const gain = audioClipGain(e, time);
                const inside = time >= e.time && time < e.time + (e.duration ?? 0);
                if (!inside) return;
                const key = `${ti}:${ei}:${e.clip}`;
                want.add(key);
                let v = voices?.get(key);
                if (v && jumped) { v.handle.stop(); voices!.delete(key); v = undefined; }
                if (!v) {
                    if (!playing) return; // started when the timeline plays, from where it is then
                    const handle = audio.playClip(e.clip, {
                        volume: e.volume * gain, startOffset: audioClipOffset(e, time), loop: !!e.loop,
                    }, typeof performance !== 'undefined' ? performance.now() : undefined);
                    if (!voices) this.voices_.set(player, (voices = new Map()));
                    voices.set(key, { handle, paused: false });
                    return;
                }
                if (!playing) {
                    if (!v.paused) { v.handle.pause(); v.paused = true; }
                    return;
                }
                if (v.paused) { v.handle.resume(); v.paused = false; }
                v.handle.setVolume(e.volume * gain);
            });
        });
        if (!voices) return;
        for (const [key, v] of voices) {
            if (want.has(key)) continue;
            v.handle.stop();
            voices.delete(key);
        }
        if (voices.size === 0) this.voices_.delete(player);
    }

    /** Stops every voice `player` has (it was despawned, or its timeline changed). */
    stop(player: Entity): void {
        const voices = this.voices_.get(player);
        if (voices) for (const v of voices.values()) v.handle.stop();
        this.voices_.delete(player);
        this.last_.delete(player);
    }

    /** Stops every voice of every player. */
    stopAll(): void {
        for (const player of [...this.voices_.keys()]) this.stop(player);
    }

    /** How many voices `player` has now: for tests and the profiler. */
    count(player: Entity): number {
        return this.voices_.get(player)?.size ?? 0;
    }
}
