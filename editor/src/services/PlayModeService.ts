import type { GameViewBridge, RuntimeEntityData } from '../panels/game-view/GameViewBridge';
import type { EntityData } from '../types/SceneTypes';
import { getEditorStore, type SceneSnapshot } from '../store/EditorStore';
import { getSharedRenderContext } from '../renderer/SharedRenderContext';

export type PlayState = 'stopped' | 'playing';

type StateChangeCallback = (state: PlayState) => void;
type EntityListCallback = (entities: RuntimeEntityData[]) => void;
type SelectionCallback = (entityId: number | null) => void;

export function runtimeToEntityData(re: RuntimeEntityData): EntityData {
    return {
        id: re.entityId,
        name: re.name,
        parent: re.parentId,
        children: re.children,
        components: re.components.map(c => ({ type: c.type, data: c.data })),
        visible: true,
    };
}

class PlayModeService {
    private state_: PlayState = 'stopped';
    private bridge_: GameViewBridge | null = null;
    private sharedMode_ = false;
    private selectedEntityId_: number | null = null;
    private cachedEntities_: RuntimeEntityData[] = [];
    private pollTimer_: ReturnType<typeof setTimeout> | null = null;
    private isRefreshing_ = false;
    private consecutiveFailures_ = 0;
    private stateListeners_ = new Set<StateChangeCallback>();
    private entityListListeners_ = new Set<EntityListCallback>();
    private selectionListeners_ = new Set<SelectionCallback>();
    private snapshot_: SceneSnapshot | null = null;

    get state(): PlayState { return this.state_; }
    get bridge(): GameViewBridge | null { return this.bridge_; }
    get runtimeEntities(): RuntimeEntityData[] { return this.cachedEntities_; }
    get selectedEntityId(): number | null { return this.selectedEntityId_; }
    get isSharedMode(): boolean { return this.sharedMode_; }

    getRuntimeEntityData(entityId: number): EntityData | null {
        const re = this.cachedEntities_.find(e => e.entityId === entityId);
        if (re) return runtimeToEntityData(re);
        return null;
    }

    enterShared(): void {
        this.snapshot_ = getEditorStore().takeSnapshot();
        this.sharedMode_ = true;
        this.bridge_ = null;
        this.state_ = 'playing';
        this.cachedEntities_ = [];
        this.selectedEntityId_ = null;

        getSharedRenderContext().enterPlayMode();
        this.emitStateChange();
    }

    async exitShared(): Promise<void> {
        if (!this.sharedMode_) return;

        const snapshot = this.snapshot_;
        this.snapshot_ = null;
        this.sharedMode_ = false;
        this.state_ = 'stopped';
        this.cachedEntities_ = [];
        this.selectedEntityId_ = null;

        await getSharedRenderContext().exitPlayMode(snapshot?.scene);

        if (snapshot) {
            getEditorStore().restoreSnapshot(snapshot);
        }

        this.emitStateChange();
        this.emitSelectionChange();
    }

    enter(bridge: GameViewBridge): void {
        if (this.state_ === 'playing') {
            this.stopPolling();
            this.bridge_ = bridge;
            this.cachedEntities_ = [];
            this.selectedEntityId_ = null;
            this.startPolling();
            this.emitSelectionChange();
            return;
        }
        this.snapshot_ = getEditorStore().takeSnapshot();
        this.bridge_ = bridge;
        this.sharedMode_ = false;
        this.state_ = 'playing';
        this.cachedEntities_ = [];
        this.selectedEntityId_ = null;
        this.startPolling();
        this.emitStateChange();
    }

    exit(): void {
        if (this.sharedMode_) {
            this.exitShared();
            return;
        }
        this.stopPolling();
        this.bridge_ = null;
        this.state_ = 'stopped';
        this.cachedEntities_ = [];
        this.selectedEntityId_ = null;
        if (this.snapshot_) {
            getEditorStore().restoreSnapshot(this.snapshot_);
            this.snapshot_ = null;
        }
        this.emitStateChange();
        this.emitSelectionChange();
    }

    selectEntity(id: number | null): void {
        this.selectedEntityId_ = id;
        this.emitSelectionChange();
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

    async queryEntityByRuntimeId(runtimeId: number): Promise<RuntimeEntityData | null> {
        if (!this.bridge_?.isReady) return null;
        try {
            return await this.bridge_.queryEntity(runtimeId);
        } catch (e) {
            console.warn('[PlayModeService] queryEntityByRuntimeId failed:', e);
            return null;
        }
    }

    async refreshEntityList(): Promise<void> {
        if (this.isRefreshing_ || !this.bridge_?.isReady) return;
        this.isRefreshing_ = true;
        try {
            this.cachedEntities_ = await this.bridge_.queryEntityList();
            this.consecutiveFailures_ = 0;
            this.emitEntityListUpdate();
        } catch (e) {
            this.consecutiveFailures_++;
            if (this.consecutiveFailures_ <= 3) {
                console.warn('[PlayModeService] refresh failed:', e);
            }
        } finally {
            this.isRefreshing_ = false;
        }
    }

    async querySelectedEntity(): Promise<RuntimeEntityData | null> {
        if (this.selectedEntityId_ === null || !this.bridge_?.isReady) return null;
        try {
            return await this.bridge_.queryEntity(this.selectedEntityId_);
        } catch (e) {
            console.warn('[PlayModeService] querySelectedEntity failed:', e);
            return null;
        }
    }

    async spawnEntity(name?: string, parentId?: number | null): Promise<number | null> {
        if (!this.bridge_?.isReady) return null;
        try {
            const result = await this.bridge_.spawnEntity(name, parentId);
            await this.refreshEntityList();
            return result.entityId;
        } catch (e) {
            console.warn('[PlayModeService] spawnEntity failed:', e);
            return null;
        }
    }

    async despawnEntity(entityId: number): Promise<void> {
        if (!this.bridge_?.isReady) return;
        try {
            await this.bridge_.despawnEntity(entityId);
            if (this.selectedEntityId_ === entityId) {
                this.selectedEntityId_ = null;
                this.emitSelectionChange();
            }
            await this.refreshEntityList();
        } catch (e) {
            console.warn('[PlayModeService] despawnEntity failed:', e);
        }
    }

    async addComponent(entityId: number, componentType: string, data?: Record<string, unknown>): Promise<void> {
        if (!this.bridge_?.isReady) return;
        try {
            await this.bridge_.addComponent(entityId, componentType, data);
            await this.refreshEntityList();
        } catch (e) {
            console.warn('[PlayModeService] addComponent failed:', e);
        }
    }

    async removeComponent(entityId: number, componentType: string): Promise<void> {
        if (!this.bridge_?.isReady) return;
        try {
            await this.bridge_.removeComponent(entityId, componentType);
            await this.refreshEntityList();
        } catch (e) {
            console.warn('[PlayModeService] removeComponent failed:', e);
        }
    }

    async renameEntity(entityId: number, name: string): Promise<void> {
        if (!this.bridge_?.isReady) return;
        try {
            await this.bridge_.renameEntity(entityId, name);
            await this.refreshEntityList();
        } catch (e) {
            console.warn('[PlayModeService] renameEntity failed:', e);
        }
    }

    async reparentEntity(entityId: number, newParentId: number | null): Promise<void> {
        if (!this.bridge_?.isReady) return;
        try {
            await this.bridge_.reparentEntity(entityId, newParentId);
            await this.refreshEntityList();
        } catch (e) {
            console.warn('[PlayModeService] reparentEntity failed:', e);
        }
    }

    private startPolling(): void {
        this.stopPolling();
        this.consecutiveFailures_ = 0;
        this.refreshEntityList();
        this.schedulePoll();
    }

    private schedulePoll(): void {
        if (this.state_ !== 'playing') return;
        const delay = this.consecutiveFailures_ > 2 ? 5000 : 500;
        this.pollTimer_ = setTimeout(async () => {
            await this.refreshEntityList();
            this.schedulePoll();
        }, delay);
    }

    private stopPolling(): void {
        if (this.pollTimer_) {
            clearTimeout(this.pollTimer_);
            this.pollTimer_ = null;
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
