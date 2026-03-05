import { describe, it, expect, beforeEach } from 'vitest';
import type { Entity } from '../src/types';
import {
    TimelineControl,
    getTimelineInstance,
    setTimelineInstance,
    clearTimelineInstances,
} from '../src/timeline/TimelineControl';
import { TimelineInstance } from '../src/timeline/TimelineSystem';
import { WrapMode, TrackType, type TimelineAsset } from '../src/timeline/TimelineTypes';

function makeAsset(duration: number): TimelineAsset {
    return {
        version: '1.0',
        type: 'timeline',
        duration,
        wrapMode: WrapMode.Once,
        tracks: [],
    };
}

describe('TimelineControl', () => {
    const entity = 1 as Entity;

    beforeEach(() => {
        clearTimelineInstances();
    });

    it('play() should start a registered instance', () => {
        const inst = new TimelineInstance(makeAsset(2));
        setTimelineInstance(entity, inst);
        TimelineControl.play(entity);
        expect(inst.playing).toBe(true);
        expect(inst.currentTime).toBe(0);
    });

    it('pause() should pause a playing instance', () => {
        const inst = new TimelineInstance(makeAsset(2));
        setTimelineInstance(entity, inst);
        inst.play();
        TimelineControl.pause(entity);
        expect(inst.playing).toBe(false);
    });

    it('stop() should reset to beginning', () => {
        const inst = new TimelineInstance(makeAsset(2));
        setTimelineInstance(entity, inst);
        inst.play();
        inst.currentTime = 1.5;
        TimelineControl.stop(entity);
        expect(inst.playing).toBe(false);
        expect(inst.currentTime).toBe(0);
    });

    it('setTime() should jump to a time', () => {
        const inst = new TimelineInstance(makeAsset(2));
        setTimelineInstance(entity, inst);
        TimelineControl.setTime(entity, 1.0);
        expect(inst.currentTime).toBe(1.0);
    });

    it('isPlaying() should return playing state', () => {
        const inst = new TimelineInstance(makeAsset(2));
        setTimelineInstance(entity, inst);
        expect(TimelineControl.isPlaying(entity)).toBe(false);
        inst.play();
        expect(TimelineControl.isPlaying(entity)).toBe(true);
    });

    it('getCurrentTime() should return current time', () => {
        const inst = new TimelineInstance(makeAsset(2));
        setTimelineInstance(entity, inst);
        inst.currentTime = 0.75;
        expect(TimelineControl.getCurrentTime(entity)).toBe(0.75);
    });

    it('should return defaults for unregistered entity', () => {
        expect(TimelineControl.isPlaying(99 as Entity)).toBe(false);
        expect(TimelineControl.getCurrentTime(99 as Entity)).toBe(0);
    });

    it('play/pause/stop should no-op for unregistered entity', () => {
        expect(() => {
            TimelineControl.play(99 as Entity);
            TimelineControl.pause(99 as Entity);
            TimelineControl.stop(99 as Entity);
            TimelineControl.setTime(99 as Entity, 1);
        }).not.toThrow();
    });
});
