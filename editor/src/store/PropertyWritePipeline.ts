import type { EntityData } from '../types/SceneTypes';
import type { PropertyChangeEvent } from './EditorStore';
import type { BuiltinPropertySync } from '../sync/BuiltinPropertySync';

export interface WriteRequest {
    entity: number;
    componentType: string;
    propertyName: string;
    newValue: unknown;
}

export interface PipelineHost {
    getEntityData(entityId: number): EntityData | undefined;
    writeDirect(entity: number, componentType: string, propertyName: string, newValue: unknown): void;
}

export type TransformHook = (
    event: PropertyChangeEvent,
    entityData: EntityData,
    pipeline: PropertyWritePipeline,
) => void;

export type SyncHook = (
    event: PropertyChangeEvent,
    entityData: EntityData,
) => boolean | void;

type HookKey = string;

export class PropertyWritePipeline {
    private transformHooks_ = new Map<HookKey, TransformHook[]>();
    private syncHooks_ = new Map<HookKey, SyncHook[]>();
    private defaultSyncHook_: SyncHook | null = null;
    private builtinSync_: BuiltinPropertySync | null = null;
    private host_: PipelineHost;

    constructor(host: PipelineHost) {
        this.host_ = host;
    }

    registerTransformHook(
        componentType: string,
        propertyName: string | '*',
        hook: TransformHook,
    ): () => void {
        const key = propertyName === '*' ? componentType : `${componentType}.${propertyName}`;
        let hooks = this.transformHooks_.get(key);
        if (!hooks) {
            hooks = [];
            this.transformHooks_.set(key, hooks);
        }
        hooks.push(hook);
        return () => {
            const idx = hooks!.indexOf(hook);
            if (idx >= 0) hooks!.splice(idx, 1);
        };
    }

    registerSyncHook(
        componentType: string,
        propertyName: string | '*',
        hook: SyncHook,
    ): () => void {
        const key = propertyName === '*' ? componentType : `${componentType}.${propertyName}`;
        let hooks = this.syncHooks_.get(key);
        if (!hooks) {
            hooks = [];
            this.syncHooks_.set(key, hooks);
        }
        hooks.push(hook);
        return () => {
            const idx = hooks!.indexOf(hook);
            if (idx >= 0) hooks!.splice(idx, 1);
        };
    }

    setBuiltinSync(sync: BuiltinPropertySync | null): void {
        this.builtinSync_ = sync;
    }

    setDefaultSyncHook(hook: SyncHook): () => void {
        const prev = this.defaultSyncHook_;
        this.defaultSyncHook_ = hook;
        return () => { this.defaultSyncHook_ = prev; };
    }

    writeDirect(
        entity: number,
        componentType: string,
        propertyName: string,
        newValue: unknown,
    ): void {
        this.host_.writeDirect(entity, componentType, propertyName, newValue);
    }

    handlePropertyNotification(event: PropertyChangeEvent): void {
        const entityData = this.host_.getEntityData(event.entity);
        if (!entityData) return;

        const specificKey = `${event.componentType}.${event.propertyName}`;
        const wildcardKey = event.componentType;

        for (const key of [specificKey, wildcardKey]) {
            const hooks = this.transformHooks_.get(key);
            if (hooks) {
                for (const hook of hooks) hook(event, entityData, this);
            }
        }

        if (this.builtinSync_?.trySync(event, entityData)) return;

        let handled = false;
        for (const key of [specificKey, wildcardKey]) {
            const hooks = this.syncHooks_.get(key);
            if (hooks) {
                for (const hook of hooks) {
                    if (hook(event, entityData) === true) handled = true;
                }
            }
        }

        if (!handled && this.defaultSyncHook_) {
            this.defaultSyncHook_(event, entityData);
        }
    }
}
