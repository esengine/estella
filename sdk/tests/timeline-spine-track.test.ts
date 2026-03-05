import { describe, it, expect } from 'vitest';
import { evaluateSpineTrack, type SpineTrackAction } from '../src/timeline/TimelineEvaluator';
import { TrackType, type SpineTrack } from '../src/timeline/TimelineTypes';

function makeSpineTrack(clips: SpineTrack['clips'], blendIn = 0): SpineTrack {
    return {
        type: TrackType.Spine,
        name: 'test',
        childPath: 'character',
        clips,
        blendIn,
    };
}

describe('evaluateSpineTrack', () => {
    it('should return no action when no clips exist', () => {
        const track = makeSpineTrack([]);
        const result = evaluateSpineTrack(track, 0, -1);
        expect(result).toBeNull();
    });

    it('should return play action when entering a clip', () => {
        const track = makeSpineTrack([
            { start: 0, duration: 2, animation: 'idle', loop: true, speed: 1 },
        ]);
        const result = evaluateSpineTrack(track, 0.5, -1);
        expect(result).not.toBeNull();
        expect(result!.action).toBe('play');
        expect(result!.animation).toBe('idle');
        expect(result!.loop).toBe(true);
        expect(result!.clipIndex).toBe(0);
    });

    it('should return null when staying in same clip', () => {
        const track = makeSpineTrack([
            { start: 0, duration: 2, animation: 'idle', loop: true, speed: 1 },
        ]);
        const result = evaluateSpineTrack(track, 1.0, 0);
        expect(result).toBeNull();
    });

    it('should return play action when transitioning between clips', () => {
        const track = makeSpineTrack([
            { start: 0, duration: 1, animation: 'attack', loop: false, speed: 1 },
            { start: 1, duration: 2, animation: 'idle', loop: true, speed: 1 },
        ]);
        const result = evaluateSpineTrack(track, 1.5, 0);
        expect(result).not.toBeNull();
        expect(result!.action).toBe('play');
        expect(result!.animation).toBe('idle');
        expect(result!.clipIndex).toBe(1);
    });

    it('should return stop when time is past all clips', () => {
        const track = makeSpineTrack([
            { start: 0, duration: 1, animation: 'attack', loop: false, speed: 1 },
        ]);
        const result = evaluateSpineTrack(track, 2.0, 0);
        expect(result).not.toBeNull();
        expect(result!.action).toBe('stop');
    });

    it('should return null when time is before first clip and no previous clip', () => {
        const track = makeSpineTrack([
            { start: 1, duration: 2, animation: 'idle', loop: true, speed: 1 },
        ]);
        const result = evaluateSpineTrack(track, 0.5, -1);
        expect(result).toBeNull();
    });

    it('should include speed from clip', () => {
        const track = makeSpineTrack([
            { start: 0, duration: 2, animation: 'run', loop: true, speed: 1.5 },
        ]);
        const result = evaluateSpineTrack(track, 0.5, -1);
        expect(result!.speed).toBe(1.5);
    });
});
