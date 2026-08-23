// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    audio-voice-cap.test.ts
 * @brief   Which sound is dropped when they cannot all be heard.
 *
 *          `priority` only means something where there is a ceiling: without one
 *          nothing is ever dropped and the field describes an ordering that never
 *          happens. These pin down the ordering itself — who survives, who is
 *          refused, and that a refusal is a handle rather than a crash.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioAPI } from '../src/audio/Audio';
import type { PlatformAudioBackend, AudioHandle, AudioBufferHandle } from '../src/audio/PlatformAudioBackend';

function handleThatPlays(): AudioHandle {
    let playing = true;
    return {
        id: 1,
        stop: vi.fn(() => { playing = false; }),
        pause: vi.fn(), resume: vi.fn(),
        setVolume: vi.fn(), setPan: vi.fn(), setLoop: vi.fn(), setPlaybackRate: vi.fn(),
        get isPlaying() { return playing; },
        currentTime: 0,
        duration: 1,
    };
}

function backendCounting(): PlatformAudioBackend & { handles: AudioHandle[] } {
    const handles: AudioHandle[] = [];
    return {
        name: 'Counting',
        initialize: vi.fn().mockResolvedValue(undefined),
        ensureResumed: vi.fn().mockResolvedValue(undefined),
        loadBuffer: vi.fn(), loadBufferFromData: vi.fn(), unloadBuffer: vi.fn(),
        play: vi.fn(() => { const h = handleThatPlays(); handles.push(h); return h; }),
        suspend: vi.fn(), resume: vi.fn(), dispose: vi.fn(),
        handles,
    } as unknown as PlatformAudioBackend & { handles: AudioHandle[] };
}

const BUF = { id: 1, duration: 1, bytes: 0 } as AudioBufferHandle;

describe('the voice cap', () => {
    let backend: PlatformAudioBackend & { handles: AudioHandle[] };
    let audio: AudioAPI;

    beforeEach(() => {
        backend = backendCounting();
        audio = new AudioAPI(backend, null);
        audio.setMaxVoices(3);
    });

    it('plays freely until the pool is full', () => {
        for (let i = 0; i < 3; i++) expect(audio.playBuffer(BUF).isPlaying).toBe(true);
        expect(backend.play).toHaveBeenCalledTimes(3);
    });

    it('refuses the sound worth least, rather than silencing what is worth more', () => {
        for (let i = 0; i < 3; i++) audio.playBuffer(BUF, { priority: 5 });
        const loser = audio.playBuffer(BUF, { priority: 1 });
        expect(loser.isPlaying).toBe(false);
        expect(backend.play).toHaveBeenCalledTimes(3);
        for (const h of backend.handles) expect(h.stop).not.toHaveBeenCalled();
    });

    it('drops the weakest voice for one worth more', () => {
        audio.playBuffer(BUF, { priority: 1 });
        audio.playBuffer(BUF, { priority: 9 });
        audio.playBuffer(BUF, { priority: 9 });
        expect(audio.playBuffer(BUF, { priority: 5 }).isPlaying).toBe(true);
        expect(backend.handles[0]!.stop).toHaveBeenCalled();
        expect(backend.handles[1]!.stop).not.toHaveBeenCalled();
    });

    it('breaks a tie by age, so a repeated sound stays audible', () => {
        for (let i = 0; i < 3; i++) audio.playBuffer(BUF, { priority: 5 });
        audio.playBuffer(BUF, { priority: 5 });
        expect(backend.handles[0]!.stop).toHaveBeenCalled();
        expect(backend.handles[1]!.stop).not.toHaveBeenCalled();
    });

    it('lets a voice that already ended free its slot', () => {
        for (let i = 0; i < 3; i++) audio.playBuffer(BUF, { priority: 9 });
        backend.handles[1]!.stop();   // as if the sound ran out
        expect(audio.playBuffer(BUF, { priority: 1 }).isPlaying).toBe(true);
    });

    it('has no ceiling at all when told so', () => {
        audio.setMaxVoices(0);
        for (let i = 0; i < 50; i++) audio.playBuffer(BUF, { priority: 0 });
        expect(backend.play).toHaveBeenCalledTimes(50);
    });
});
