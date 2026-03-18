export interface PropertyChangeEvent {
    entity: number;
    componentType: string;
    propertyName: string;
    oldValue: unknown;
    newValue: unknown;
}

export interface HierarchyChangeEvent {
    entity: number;
    newParent: number | null;
}

export interface VisibilityChangeEvent {
    entity: number;
    visible: boolean;
}

export interface EntityLifecycleEvent {
    entity: number;
    type: 'created' | 'deleted';
    parent: number | null;
}

export interface ComponentChangeEvent {
    entity: number;
    componentType: string;
    action: 'added' | 'removed';
}

export interface AssetSelection {
    path: string;
    type: string;
    name: string;
}

export type EditorEventMap = {
    'selection:changed':   { entities: ReadonlySet<number> };
    'selection:asset':     { asset: AssetSelection | null };
    'selection:focus':     { entityId: number };
    'scene:loaded':        { filePath: string | null };
    'scene:dirty':         { isDirty: boolean };
    'scene:synced':        {};
    'property:changed':    PropertyChangeEvent;
    'hierarchy:changed':   HierarchyChangeEvent;
    'entity:lifecycle':    EntityLifecycleEvent;
    'component:changed':   ComponentChangeEvent;
    'visibility:changed':  VisibilityChangeEvent;
    'command:executed':    { structural: boolean };
    'tiletool:changed':   {};
    'gizmo:requested':    { id: string };
};

type Handler<T> = (data: T) => void;

export class EditorEventBus {
    private handlers_ = new Map<string, Set<Handler<any>>>();
    private batchedEvents_ = new Map<string, unknown>();
    private rafId_: number | null = null;

    on<K extends keyof EditorEventMap>(
        event: K,
        handler: Handler<EditorEventMap[K]>,
    ): () => void {
        if (!this.handlers_.has(event)) {
            this.handlers_.set(event, new Set());
        }
        this.handlers_.get(event)!.add(handler);
        return () => this.handlers_.get(event)?.delete(handler);
    }

    emit<K extends keyof EditorEventMap>(event: K, data: EditorEventMap[K]): void {
        this.handlers_.get(event)?.forEach(h => h(data));
    }

    emitBatched<K extends keyof EditorEventMap>(event: K, data: EditorEventMap[K]): void {
        this.batchedEvents_.set(event, data);
        if (this.rafId_ === null) {
            this.rafId_ = requestAnimationFrame(() => this.flushBatch_());
        }
    }

    clear(): void {
        this.handlers_.clear();
        this.batchedEvents_.clear();
        if (this.rafId_ !== null) {
            cancelAnimationFrame(this.rafId_);
            this.rafId_ = null;
        }
    }

    private flushBatch_(): void {
        this.rafId_ = null;
        const pending = new Map(this.batchedEvents_);
        this.batchedEvents_.clear();
        for (const [event, data] of pending) {
            this.handlers_.get(event)?.forEach(h => h(data));
        }
    }
}

import { getEditorContainer } from '../container/EditorContainer';
import { EDITOR_EVENT_BUS } from '../container/tokens';

export function getEditorEventBus(): EditorEventBus {
    return getEditorContainer().get(EDITOR_EVENT_BUS, 'default')!;
}
