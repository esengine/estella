import type { GameViewBridge, RuntimeEntityData } from '../panels/game-view/GameViewBridge';

export type PlayState = 'stopped' | 'playing';

type StateChangeCallback = (state: PlayState) => void;
type EntityListCallback = (entities: RuntimeEntityData[]) => void;
type SelectionCallback = (entityId: number | null) => void;

class PlayModeService {
    private state_: PlayState = 'stopped';
    private bridge_: GameViewBridge | null = null;
    private selectedEntityId_: number | null = null;
    private cachedEntities_: RuntimeEntityData[] = [];
    private pollTimer_: ReturnType<typeof setInterval> | null = null;
    private detailTimer_: ReturnType<typeof setInterval> | null = null;
    private stateListeners_ = new Set<StateChangeCallback>();
    private entityListListeners_ = new Set<EntityListCallback>();
    private selectionListeners_ = new Set<SelectionCallback>();

    get state(): PlayState { return this.state_; }
    get bridge(): GameViewBridge | null { return this.bridge_; }
    get runtimeEntities(): RuntimeEntityData[] { return this.cachedEntities_; }
    get selectedEntityId(): number | null { return this.selectedEntityId_; }

    enter(bridge: GameViewBridge): void {
        this.bridge_ = bridge;
        this.state_ = 'playing';
        this.cachedEntities_ = [];
        this.selectedEntityId_ = null;
        this.startPolling();
        this.emitStateChange();
    }

    exit(): void {
        this.stopPolling();
        this.stopDetailPolling();
        this.bridge_ = null;
        this.state_ = 'stopped';
        this.cachedEntities_ = [];
        this.selectedEntityId_ = null;
        this.emitStateChange();
        this.emitSelectionChange();
    }

    selectEntity(id: number | null): void {
        this.selectedEntityId_ = id;
        this.emitSelectionChange();
        if (id !== null) {
            this.startDetailPolling();
        } else {
            this.stopDetailPolling();
        }
    }

    onStateChange(cb: StateChangeCallback): () => void {
        this.stateListeners_.add(cb);
        return () => { this.stateListeners_.delete(cb); };
    }

    onEntityListUpdate(cb: EntityListCallback): () => void {
        this.entityListListeners_.add(cb);
        return () => { this.entityListListeners_.delete(cb); };
    }

    onSelectionChange(cb: SelectionCallback): () => void {
        this.selectionListeners_.add(cb);
        return () => { this.selectionListeners_.delete(cb); };
    }

    async refreshEntityList(): Promise<void> {
        if (!this.bridge_?.isReady) return;
        try {
            this.cachedEntities_ = await this.bridge_.queryEntityList();
            this.emitEntityListUpdate();
        } catch {}
    }

    async querySelectedEntity(): Promise<RuntimeEntityData | null> {
        if (this.selectedEntityId_ === null || !this.bridge_?.isReady) return null;
        try {
            return await this.bridge_.queryEntity(this.selectedEntityId_);
        } catch { return null; }
    }

    private startPolling(): void {
        this.stopPolling();
        this.refreshEntityList();
        this.pollTimer_ = setInterval(() => this.refreshEntityList(), 1000);
    }

    private stopPolling(): void {
        if (this.pollTimer_) {
            clearInterval(this.pollTimer_);
            this.pollTimer_ = null;
        }
    }

    private startDetailPolling(): void {
        this.stopDetailPolling();
        this.detailTimer_ = setInterval(() => {
            this.emitSelectionChange();
        }, 500);
    }

    private stopDetailPolling(): void {
        if (this.detailTimer_) {
            clearInterval(this.detailTimer_);
            this.detailTimer_ = null;
        }
    }

    private emitStateChange(): void {
        for (const cb of this.stateListeners_) cb(this.state_);
    }

    private emitEntityListUpdate(): void {
        for (const cb of this.entityListListeners_) cb(this.cachedEntities_);
    }

    private emitSelectionChange(): void {
        for (const cb of this.selectionListeners_) cb(this.selectedEntityId_);
    }
}

let instance: PlayModeService | null = null;

export function getPlayModeService(): PlayModeService {
    if (!instance) instance = new PlayModeService();
    return instance;
}
