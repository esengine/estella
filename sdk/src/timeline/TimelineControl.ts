import type { Entity } from '../types';
import type { World } from '../world';
import { TimelineInstance } from './TimelineSystem';

const instances_ = new Map<Entity, TimelineInstance>();

export function getTimelineInstance(entity: Entity): TimelineInstance | undefined {
    return instances_.get(entity);
}

export function setTimelineInstance(entity: Entity, instance: TimelineInstance): void {
    instances_.set(entity, instance);
}

export function removeTimelineInstance(entity: Entity): void {
    instances_.delete(entity);
}

export function getAllTimelineInstances(): Map<Entity, TimelineInstance> {
    return instances_;
}

export function clearTimelineInstances(): void {
    instances_.clear();
}

export const TimelineControl = {
    play(entity: Entity): void {
        const inst = instances_.get(entity);
        if (inst) inst.play();
    },

    pause(entity: Entity): void {
        const inst = instances_.get(entity);
        if (inst) inst.pause();
    },

    stop(entity: Entity): void {
        const inst = instances_.get(entity);
        if (inst) inst.stop();
    },

    setTime(entity: Entity, time: number): void {
        const inst = instances_.get(entity);
        if (inst) inst.setTime(time);
    },

    isPlaying(entity: Entity): boolean {
        const inst = instances_.get(entity);
        return inst?.playing ?? false;
    },

    getCurrentTime(entity: Entity): number {
        const inst = instances_.get(entity);
        return inst?.currentTime ?? 0;
    },
};
