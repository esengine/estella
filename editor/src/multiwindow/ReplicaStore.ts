import type { EntityData, SceneData } from '../types/SceneTypes';
import type { EditorState, EditorListener, AssetSelection, DirtyFlag } from '../store/EditorStore';
import { CommandRegistry, type SerializedCommand } from '../commands/Command';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
    CHANNEL_CMD_EXECUTED,
    CHANNEL_CMD_REQUEST,
    CHANNEL_CMD_SNAPSHOT,
    type CmdExecutedMessage,
    type CmdSnapshotMessage,
} from './protocol';

export class ReplicaStore {
    private state_: EditorState;
    private entityMap_ = new Map<number, EntityData>();
    private version_ = 0;
    private listeners_ = new Set<EditorListener>();
    private unlisteners_: UnlistenFn[] = [];
    private pendingNotify_ = false;
    private dirtyFlags_ = new Set<DirtyFlag>();

    constructor() {
        this.state_ = {
            scene: { version: '1', name: 'Untitled', entities: [] },
            selectedEntities: new Set(),
            selectedAsset: null,
            isDirty: false,
            filePath: null,
        };
    }

    get scene(): SceneData {
        return this.state_.scene;
    }

    get selectedEntities(): ReadonlySet<number> {
        return this.state_.selectedEntities;
    }

    get selectedAsset(): AssetSelection | null {
        return this.state_.selectedAsset;
    }

    get entityMap(): ReadonlyMap<number, EntityData> {
        return this.entityMap_;
    }

    async connect(): Promise<void> {
        const unlistenCmd = await listen<CmdExecutedMessage>(CHANNEL_CMD_EXECUTED, (event) => {
            this.handleCommandExecuted(event.payload);
        });

        const unlistenSnapshot = await listen<CmdSnapshotMessage>(CHANNEL_CMD_SNAPSHOT, (event) => {
            this.handleSnapshot(event.payload);
        });

        this.unlisteners_.push(unlistenCmd, unlistenSnapshot);

        emit(CHANNEL_CMD_SNAPSHOT + ':request', {});
    }

    subscribe(listener: EditorListener): () => void {
        this.listeners_.add(listener);
        return () => this.listeners_.delete(listener);
    }

    sendCommand(serialized: SerializedCommand): void {
        emit(CHANNEL_CMD_REQUEST, { serialized });
    }

    getEntityData(entityId: number): EntityData | undefined {
        return this.entityMap_.get(entityId);
    }

    dispose(): void {
        for (const unlisten of this.unlisteners_) {
            unlisten();
        }
        this.unlisteners_ = [];
        this.listeners_.clear();
    }

    private handleCommandExecuted(msg: CmdExecutedMessage): void {
        if (msg.version !== this.version_ + 1) {
            emit(CHANNEL_CMD_SNAPSHOT + ':request', {});
            return;
        }

        this.version_ = msg.version;

        const cmd = CommandRegistry.deserialize(
            msg.serialized,
            this.state_.scene,
            this.entityMap_,
        );

        if (!cmd) {
            emit(CHANNEL_CMD_SNAPSHOT + ':request', {});
            return;
        }

        cmd.execute();
        cmd.updateEntityMap(this.entityMap_, false);

        if (cmd.structural) {
            this.rebuildEntityMap();
            this.notify('hierarchy');
        } else {
            this.notify('scene');
        }
    }

    private handleSnapshot(msg: CmdSnapshotMessage): void {
        this.state_.scene = msg.scene;
        this.state_.selectedEntities = new Set(msg.selectedEntities);
        this.version_ = msg.version;
        this.rebuildEntityMap();
        this.notify('hierarchy');
    }

    private rebuildEntityMap(): void {
        this.entityMap_.clear();
        for (const entity of this.state_.scene.entities) {
            this.entityMap_.set(entity.id, entity);
        }
    }

    private notify(flag: DirtyFlag): void {
        this.dirtyFlags_.add(flag);
        if (this.pendingNotify_) return;
        this.pendingNotify_ = true;
        requestAnimationFrame(() => {
            this.pendingNotify_ = false;
            const flags = new Set(this.dirtyFlags_);
            this.dirtyFlags_.clear();
            for (const listener of this.listeners_) {
                listener(this.state_, flags);
            }
        });
    }
}
