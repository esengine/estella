import type { Entity } from '../types';

const handles_ = new Map<Entity, number>();
let module_: any = null;

export function setTimelineModule(mod: any): void {
    module_ = mod;
}

export function setTimelineHandle(entity: Entity, handle: number): void {
    handles_.set(entity, handle);
}

export function getTimelineHandle(entity: Entity): number | undefined {
    return handles_.get(entity);
}

export function removeTimelineHandle(entity: Entity): void {
    const handle = handles_.get(entity);
    if (handle && module_) {
        module_._tl_destroy(handle);
    }
    handles_.delete(entity);
}

export function clearTimelineHandles(): void {
    if (module_) {
        for (const handle of handles_.values()) {
            module_._tl_destroy(handle);
        }
    }
    handles_.clear();
}

export const TimelineControl = {
    play(entity: Entity): void {
        const handle = handles_.get(entity);
        if (handle && module_) module_._tl_play(handle);
    },

    pause(entity: Entity): void {
        const handle = handles_.get(entity);
        if (handle && module_) module_._tl_pause(handle);
    },

    stop(entity: Entity): void {
        const handle = handles_.get(entity);
        if (handle && module_) module_._tl_stop(handle);
    },

    setTime(entity: Entity, time: number): void {
        const handle = handles_.get(entity);
        if (handle && module_) module_._tl_setTime(handle, time);
    },

    isPlaying(entity: Entity): boolean {
        const handle = handles_.get(entity);
        return handle && module_ ? module_._tl_isPlaying(handle) !== 0 : false;
    },

    getCurrentTime(entity: Entity): number {
        const handle = handles_.get(entity);
        return handle && module_ ? module_._tl_getTime(handle) : 0;
    },
};
