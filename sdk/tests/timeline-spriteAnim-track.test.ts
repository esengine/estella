import { describe, it, expect } from 'vitest';
import { evaluateSpriteAnimTrack, type SpriteAnimTrackAction } from '../src/timeline/TimelineEvaluator';
import { TrackType, type SpriteAnimTrack } from '../src/timeline/TimelineTypes';

function makeSpriteAnimTrack(clip: string, startTime: number): SpriteAnimTrack {
    return {
        type: TrackType.SpriteAnim,
        name: 'test',
        childPath: 'fx',
        clip,
        startTime,
    };
}

describe('evaluateSpriteAnimTrack', () => {
    it('should return play when crossing startTime', () => {
        const track = makeSpriteAnimTrack('assets/fx/boom.esanim', 0.5);
        const result = evaluateSpriteAnimTrack(track, 0.6, 0.4);
        expect(result).not.toBeNull();
        expect(result!.action).toBe('play');
        expect(result!.clip).toBe('assets/fx/boom.esanim');
    });

    it('should return null when before startTime', () => {
        const track = makeSpriteAnimTrack('assets/fx/boom.esanim', 1.0);
        const result = evaluateSpriteAnimTrack(track, 0.5, 0.4);
        expect(result).toBeNull();
    });

    it('should return null when already past startTime', () => {
        const track = makeSpriteAnimTrack('assets/fx/boom.esanim', 0.5);
        const result = evaluateSpriteAnimTrack(track, 1.0, 0.8);
        expect(result).toBeNull();
    });

    it('should return play on exact startTime', () => {
        const track = makeSpriteAnimTrack('assets/fx/boom.esanim', 0.5);
        const result = evaluateSpriteAnimTrack(track, 0.5, 0.4);
        expect(result).not.toBeNull();
        expect(result!.action).toBe('play');
    });

    it('should return play when previousTime is 0 and startTime is 0', () => {
        const track = makeSpriteAnimTrack('assets/fx/boom.esanim', 0);
        const result = evaluateSpriteAnimTrack(track, 0.1, 0);
        expect(result).not.toBeNull();
        expect(result!.action).toBe('play');
    });
});
