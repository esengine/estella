import type { Entity } from '../types';
import type { ESEngineModule } from '../wasm';
import { defineResource } from '../resource';

/**
 * Per-App timeline playback control. Holds this App's entity->handle map and the
 * (guarded) wasm module; published as the {@link Timeline} resource. Replaces
 * the former process-global `TimelineControl` object + module/handle globals so
 * two Apps' timelines never collide on entity id.
 *
 * `TimelinePlugin` keeps the module current via {@link setModule} each frame and
 * records handles via {@link setHandle}; game code drives playback through
 * `app.getResource(Timeline)`.
 */
export class TimelineApi {
    private readonly handles_ = new Map<Entity, number>();
    private module_: ESEngineModule | null = null;

    /** @internal Plugin keeps the guarded module current each frame. */
    setModule(mod: ESEngineModule | null): void {
        this.module_ = mod;
    }

    /** @internal */
    setHandle(entity: Entity, handle: number): void {
        this.handles_.set(entity, handle);
    }

    getHandle(entity: Entity): number | undefined {
        return this.handles_.get(entity);
    }

    /** @internal Destroys the C++ timeline (if loaded) and forgets the handle. */
    removeHandle(entity: Entity): void {
        const handle = this.handles_.get(entity);
        if (handle && this.module_) {
            this.module_._tl_destroy(handle);
        }
        this.handles_.delete(entity);
    }

    /** @internal */
    clearHandles(): void {
        if (this.module_) {
            for (const handle of this.handles_.values()) {
                this.module_._tl_destroy(handle);
            }
        }
        this.handles_.clear();
    }

    play(entity: Entity): void {
        const handle = this.handles_.get(entity);
        if (handle && this.module_) this.module_._tl_play(handle);
    }

    pause(entity: Entity): void {
        const handle = this.handles_.get(entity);
        if (handle && this.module_) this.module_._tl_pause(handle);
    }

    stop(entity: Entity): void {
        const handle = this.handles_.get(entity);
        if (handle && this.module_) this.module_._tl_stop(handle);
    }

    setTime(entity: Entity, time: number): void {
        const handle = this.handles_.get(entity);
        if (handle && this.module_) this.module_._tl_setTime(handle, time);
    }

    isPlaying(entity: Entity): boolean {
        const handle = this.handles_.get(entity);
        return handle && this.module_ ? this.module_._tl_isPlaying(handle) !== 0 : false;
    }

    getCurrentTime(entity: Entity): number {
        const handle = this.handles_.get(entity);
        return handle && this.module_ ? this.module_._tl_getTime(handle) : 0;
    }
}

/**
 * Per-App timeline control resource, published by `TimelinePlugin`. Drive
 * playback as `app.getResource(Timeline).play(entity)`.
 */
export const Timeline = defineResource<TimelineApi>(null!, 'Timeline');
