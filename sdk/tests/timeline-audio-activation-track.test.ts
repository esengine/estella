import { describe, it, expect } from 'vitest';
import {
    evaluateAudioTrack,
    evaluateActivationTrack,
    type AudioTrackAction,
} from '../src/timeline/TimelineEvaluator';
import { TrackType, type AudioTrack, type ActivationTrack } from '../src/timeline/TimelineTypes';

describe('evaluateAudioTrack', () => {
    function makeAudioTrack(events: AudioTrack['events']): AudioTrack {
        return {
            type: TrackType.Audio,
            name: 'sfx',
            childPath: '',
            events,
        };
    }

    it('should return events that fall between previousTime and currentTime', () => {
        const track = makeAudioTrack([
            { time: 0.5, clip: 'whoosh.mp3', volume: 0.8 },
            { time: 1.5, clip: 'boom.mp3', volume: 1.0 },
        ]);
        const result = evaluateAudioTrack(track, 0.6, 0.4);
        expect(result).toHaveLength(1);
        expect(result[0].clip).toBe('whoosh.mp3');
        expect(result[0].volume).toBe(0.8);
    });

    it('should return multiple events when time range spans them', () => {
        const track = makeAudioTrack([
            { time: 0.5, clip: 'a.mp3', volume: 1 },
            { time: 0.7, clip: 'b.mp3', volume: 1 },
        ]);
        const result = evaluateAudioTrack(track, 1.0, 0.3);
        expect(result).toHaveLength(2);
    });

    it('should return empty when no events in range', () => {
        const track = makeAudioTrack([
            { time: 2.0, clip: 'late.mp3', volume: 1 },
        ]);
        const result = evaluateAudioTrack(track, 0.5, 0.0);
        expect(result).toHaveLength(0);
    });

    it('should return empty for no events', () => {
        const track = makeAudioTrack([]);
        const result = evaluateAudioTrack(track, 0.5, 0.0);
        expect(result).toHaveLength(0);
    });

    it('should trigger on exact event time', () => {
        const track = makeAudioTrack([
            { time: 1.0, clip: 'exact.mp3', volume: 0.5 },
        ]);
        const result = evaluateAudioTrack(track, 1.0, 0.9);
        expect(result).toHaveLength(1);
    });
});

describe('evaluateActivationTrack', () => {
    function makeActivationTrack(ranges: ActivationTrack['ranges']): ActivationTrack {
        return {
            type: TrackType.Activation,
            name: 'show',
            childPath: 'particles',
            ranges,
        };
    }

    it('should return true when time is inside a range', () => {
        const track = makeActivationTrack([{ start: 0.5, end: 2.0 }]);
        expect(evaluateActivationTrack(track, 1.0)).toBe(true);
    });

    it('should return false when time is outside all ranges', () => {
        const track = makeActivationTrack([{ start: 0.5, end: 2.0 }]);
        expect(evaluateActivationTrack(track, 0.3)).toBe(false);
        expect(evaluateActivationTrack(track, 2.5)).toBe(false);
    });

    it('should return true at range start boundary', () => {
        const track = makeActivationTrack([{ start: 1.0, end: 2.0 }]);
        expect(evaluateActivationTrack(track, 1.0)).toBe(true);
    });

    it('should return false at range end boundary', () => {
        const track = makeActivationTrack([{ start: 1.0, end: 2.0 }]);
        expect(evaluateActivationTrack(track, 2.0)).toBe(false);
    });

    it('should handle multiple ranges', () => {
        const track = makeActivationTrack([
            { start: 0.0, end: 1.0 },
            { start: 2.0, end: 3.0 },
        ]);
        expect(evaluateActivationTrack(track, 0.5)).toBe(true);
        expect(evaluateActivationTrack(track, 1.5)).toBe(false);
        expect(evaluateActivationTrack(track, 2.5)).toBe(true);
    });

    it('should return false for empty ranges', () => {
        const track = makeActivationTrack([]);
        expect(evaluateActivationTrack(track, 0.5)).toBe(false);
    });
});
