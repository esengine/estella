// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * Project audio config: tolerant parsing and full-state application through the
 * AudioAPI surface (creates missing buses, sets volume/mute/effects/duck, clears
 * an absent duck rule so live re-apply works).
 */
import { describe, it, expect, vi } from 'vitest';
import { parseAudioProjectConfig, applyAudioProjectConfig } from '../src/audio/AudioProjectConfig';
import type { AudioAPI } from '../src/audio/Audio';

function mockAudioApi() {
    return {
        ensureBus: vi.fn(() => true),
        setBusVolume: vi.fn(),
        muteBus: vi.fn(),
        setBusEffects: vi.fn(() => true),
        setBusDucking: vi.fn(() => true),
    } as unknown as AudioAPI;
}

describe('parseAudioProjectConfig', () => {
    it('normalizes valid buses and drops junk', () => {
        const cfg = parseAudioProjectConfig({
            buses: [
                {
                    name: 'music', volume: 1.5,
                    effects: [{ type: 'filter', filter: 'lowpass', frequency: 700 }],
                    duck: { trigger: 'voice', amount: 0.3, release: 0.5 },
                },
                { name: '', volume: 0.5 },              // no name
                { name: 'ambience', parent: 'sfx' },     // custom bus
                'nonsense',
            ],
        });
        expect(cfg.buses).toEqual([
            {
                name: 'music', volume: 1,
                effects: [{ type: 'filter', filter: 'lowpass', frequency: 700 }],
                duck: { trigger: 'voice', amount: 0.3, release: 0.5 },
            },
            { name: 'ambience', parent: 'sfx' },
        ]);
    });

    it('returns {} for empty or invalid input', () => {
        expect(parseAudioProjectConfig(undefined)).toEqual({});
        expect(parseAudioProjectConfig({ buses: [] })).toEqual({});
    });
});

describe('applyAudioProjectConfig', () => {
    it('ensures buses then applies volume/mute/effects/duck', () => {
        const audio = mockAudioApi();
        applyAudioProjectConfig(audio, {
            buses: [{
                name: 'ambience', parent: 'sfx', volume: 0.6, muted: true,
                effects: [{ type: 'reverb', wet: 0.4 }],
                duck: { trigger: 'voice', amount: 0.2 },
            }],
        });
        expect(audio.ensureBus).toHaveBeenCalledWith('ambience', 'sfx');
        expect(audio.setBusVolume).toHaveBeenCalledWith('ambience', 0.6);
        expect(audio.muteBus).toHaveBeenCalledWith('ambience', true);
        expect(audio.setBusEffects).toHaveBeenCalledWith('ambience', [{ type: 'reverb', wet: 0.4 }]);
        expect(audio.setBusDucking).toHaveBeenCalledWith('ambience', { trigger: 'voice', amount: 0.2 });
    });

    it('clears effects and duck for declarations without them (full-state re-apply)', () => {
        const audio = mockAudioApi();
        applyAudioProjectConfig(audio, { buses: [{ name: 'music' }] });
        expect(audio.setBusEffects).toHaveBeenCalledWith('music', []);
        expect(audio.setBusDucking).toHaveBeenCalledWith('music', null);
    });

    it('stops silently when the backend has no mixer', () => {
        const audio = mockAudioApi();
        (audio.ensureBus as ReturnType<typeof vi.fn>).mockReturnValue(false);
        applyAudioProjectConfig(audio, { buses: [{ name: 'music', volume: 0.5 }] });
        expect(audio.setBusVolume).not.toHaveBeenCalled();
    });

    it('is a no-op for undefined config', () => {
        const audio = mockAudioApi();
        applyAudioProjectConfig(audio, undefined);
        expect(audio.ensureBus).not.toHaveBeenCalled();
    });
});
