import { describe, it, expect, vi } from 'vitest';
import { AudioPlugin, audioPlugin } from '../src/audio/AudioPlugin';

describe('AudioPlugin', () => {
    it('should be exported as singleton', () => {
        expect(audioPlugin).toBeInstanceOf(AudioPlugin);
    });

    it('should have name "AudioPlugin"', () => {
        expect(audioPlugin.name).toBe('AudioPlugin');
    });

    it('should have a build method', () => {
        expect(typeof audioPlugin.build).toBe('function');
    });

    it('should have a cleanup method', () => {
        expect(typeof audioPlugin.cleanup).toBe('function');
    });
});
