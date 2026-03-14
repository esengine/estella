import type { Entity } from '../types';

export type ReleaseCallback = () => void;

export class SceneHandle {
    readonly entities: Entity[];
    private releaseCallbacks_: ReleaseCallback[];
    private released_ = false;

    constructor(entities: Entity[], releaseCallbacks: ReleaseCallback[]) {
        this.entities = entities;
        this.releaseCallbacks_ = releaseCallbacks;
    }

    get isReleased(): boolean {
        return this.released_;
    }

    release(): void {
        if (this.released_) return;
        this.released_ = true;
        for (const cb of this.releaseCallbacks_) {
            cb();
        }
        this.releaseCallbacks_ = [];
    }
}
