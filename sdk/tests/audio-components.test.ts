import { describe, it, expect, beforeEach } from 'vitest';
import { AudioSource, AudioListener } from '../src/audio/AudioComponents';
import { AttenuationModel } from '../src/audio/SpatialAudio';

describe('AudioComponents', () => {
    describe('AudioSource', () => {
        it('should be defined with correct name', () => {
            expect(AudioSource._name).toBe('AudioSource');
        });

        it('should have correct defaults', () => {
            const defaults = AudioSource._default;
            expect(defaults.clip).toBe('');
            expect(defaults.bus).toBe('sfx');
            expect(defaults.volume).toBe(1.0);
            expect(defaults.pitch).toBe(1.0);
            expect(defaults.loop).toBe(false);
            expect(defaults.playOnAwake).toBe(false);
            expect(defaults.spatial).toBe(false);
            expect(defaults.minDistance).toBe(100);
            expect(defaults.maxDistance).toBe(1000);
            expect(defaults.attenuationModel).toBe(AttenuationModel.Inverse);
            expect(defaults.rolloff).toBe(1.0);
            expect(defaults.priority).toBe(0);
            expect(defaults.enabled).toBe(true);
        });

        it('should be a user-defined component (not builtin)', () => {
            expect(AudioSource._builtin).toBe(false);
        });
    });

    describe('AudioListener', () => {
        it('should be defined with correct name', () => {
            expect(AudioListener._name).toBe('AudioListener');
        });

        it('should have correct defaults', () => {
            const defaults = AudioListener._default;
            expect(defaults.enabled).toBe(true);
        });

        it('should be a user-defined component (not builtin)', () => {
            expect(AudioListener._builtin).toBe(false);
        });
    });
});
