import { describe, it, expect, vi } from 'vitest';
import { AudioPlugin, audioPlugin } from '../src/audio/AudioPlugin';
import { Audio } from '../src/audio/Audio';

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

    it('should accept config options', () => {
        const plugin = new AudioPlugin({
            initialPoolSize: 32,
            masterVolume: 0.8,
            musicVolume: 0.5,
            sfxVolume: 0.9,
        });
        expect(plugin.name).toBe('AudioPlugin');
    });

    it('should call Audio.dispose on cleanup', () => {
        const disposeSpy = vi.spyOn(Audio, 'dispose').mockImplementation(() => {});
        const plugin = new AudioPlugin();
        plugin.cleanup();
        expect(disposeSpy).toHaveBeenCalled();
        disposeSpy.mockRestore();
    });
});
