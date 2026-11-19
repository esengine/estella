// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Audio clips on a timeline: a voice while the playhead is inside, from where it is in the sound, faded, paused
 *        with the timeline, started again after a jump and stopped at the clip's end; a moment still fires once.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TimelineAudioVoices, audioClipGain, audioClipOffset } from '../src/timeline/timelineAudio';
import { detectTimelineEvents, createTimelineState } from '../src/timeline/TimelineDrive';
import { WrapMode, TrackType, type TimelineAsset, type AudioEvent } from '../src/timeline/TimelineTypes';
import { parseTimelineAsset } from '../src/timeline/TimelineLoader';
import { serializeTimelineToJson } from '../src/timeline/TimelineSerializer';

interface FakeVoice { clip: string; offset: number; loop: boolean; volume: number; state: 'playing' | 'paused' | 'stopped' }

/** An audio API that records what is asked of it. */
function fakeAudio() {
    const voices: FakeVoice[] = [];
    const api = {
        playClip(clip: string, config: { volume?: number; startOffset?: number; loop?: boolean }) {
            const v: FakeVoice = { clip, offset: config.startOffset ?? 0, loop: !!config.loop, volume: config.volume ?? 1, state: 'playing' };
            voices.push(v);
            return {
                id: voices.length, isPlaying: true, currentTime: 0, duration: 0,
                stop: () => { v.state = 'stopped'; }, pause: () => { v.state = 'paused'; }, resume: () => { v.state = 'playing'; },
                setVolume: (x: number) => { v.volume = x; }, setPan() {}, setLoop() {}, setPlaybackRate() {},
            };
        },
    };
    return { api: api as never, voices };
}

const line: AudioEvent = { time: 1, clip: 'line.wav', volume: 0.8, duration: 3, clipIn: 0.5, fadeIn: 1, fadeOut: 0.5 };
const asset = (): TimelineAsset => ({
    version: '1.3', type: 'timeline', duration: 6, wrapMode: WrapMode.Once,
    tracks: [{ type: TrackType.Audio, name: '', childPath: '', events: [line, { time: 5, clip: 'ding.wav', volume: 1 }] }],
});

describe('audio clip shape', () => {
    it('fades in from its start and out to its end, and is silent outside it', () => {
        expect(audioClipGain(line, 0.5)).toBe(0);
        expect(audioClipGain(line, 1.5)).toBeCloseTo(0.5, 9);
        expect(audioClipGain(line, 2.5)).toBe(1);
        expect(audioClipGain(line, 3.75)).toBeCloseTo(0.5, 9);
        expect(audioClipGain(line, 4)).toBe(0);
        expect(audioClipOffset(line, 2)).toBeCloseTo(1.5, 9);
    });

    it('keeps its clip fields through a save, and a moment stays a moment', () => {
        const back = parseTimelineAsset(JSON.parse(serializeTimelineToJson(asset())));
        const events = (back.tracks[0] as { events: AudioEvent[] }).events;
        expect(events[0]).toEqual(line);
        expect(events[1]).toEqual({ time: 5, clip: 'ding.wav', volume: 1 });
    });
});

describe('TimelineAudioVoices', () => {
    let audio: ReturnType<typeof fakeAudio>;
    let voices: TimelineAudioVoices;
    beforeEach(() => { audio = fakeAudio(); voices = new TimelineAudioVoices(); });
    const P = 7 as never;

    it('starts a voice as the playhead enters, from Clip In, and fades it', () => {
        voices.sync(P, asset(), 0.9, true, audio.api);
        expect(audio.voices).toHaveLength(0);
        voices.sync(P, asset(), 1.1, true, audio.api);
        expect(audio.voices).toHaveLength(1);
        expect(audio.voices[0]!.offset).toBeCloseTo(0.6, 9);
        expect(audio.voices[0]!.volume).toBeCloseTo(0.08, 9);
        voices.sync(P, asset(), 1.3, true, audio.api);
        expect(audio.voices[0]!.volume).toBeCloseTo(0.24, 9);
    });

    it('joins in the middle when the playhead lands inside, pauses with the timeline and resumes', () => {
        voices.sync(P, asset(), 3, true, audio.api);
        expect(audio.voices[0]!.offset).toBeCloseTo(2.5, 9);
        voices.sync(P, asset(), 3, false, audio.api);
        expect(audio.voices[0]!.state).toBe('paused');
        voices.sync(P, asset(), 3.05, true, audio.api);
        expect(audio.voices[0]!.state).toBe('playing');
        expect(audio.voices).toHaveLength(1);
    });

    it('starts again where the playhead jumped to, and stops at the clip’s end', () => {
        voices.sync(P, asset(), 2, true, audio.api);
        voices.sync(P, asset(), 3.5, true, audio.api);
        expect(audio.voices.map((v) => v.state)).toEqual(['stopped', 'playing']);
        expect(audio.voices[1]!.offset).toBeCloseTo(3, 9);
        voices.sync(P, asset(), 4.1, true, audio.api);
        expect(audio.voices[1]!.state).toBe('stopped');
        expect(voices.count(P)).toBe(0);
    });

    it('stops a player’s voices when it goes', () => {
        voices.sync(P, asset(), 2, true, audio.api);
        voices.stop(P);
        expect(audio.voices[0]!.state).toBe('stopped');
    });

    it('leaves a moment to fire once, and a clip out of the one-shots', () => {
        const s = createTimelineState();
        s.time = 6;
        const fired = detectTimelineEvents(asset(), s, () => 1 as never, 1 as never, [[0, 6]]);
        expect(fired.map((e) => e.str)).toEqual(['ding.wav']);
    });
});
