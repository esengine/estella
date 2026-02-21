import type { Entity } from 'esengine';
import type { EditorStore } from '../store/EditorStore';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { serializeEditorState } from './stateSerializer';
import {
    CHANNEL_STATE,
    CHANNEL_ACTION,
    CHANNEL_ACTION_RESULT,
    CHANNEL_PANEL_OPENED,
    CHANNEL_PANEL_CLOSED,
    CHANNEL_OUTPUT,
    type ActionMessage,
    type ActionResultMessage,
    type PanelOpenedMessage,
    type PanelClosedMessage,
    type OutputMessage,
    type OutputType,
} from './protocol';

export class MainWindowBridge {
    private store_: EditorStore;
    private unlisteners_: UnlistenFn[] = [];
    private unsubscribe_: (() => void) | null = null;
    private started_ = false;

    constructor(store: EditorStore) {
        this.store_ = store;
    }

    async start(): Promise<void> {
        if (this.started_) return;
        this.started_ = true;

        const unlistenAction = await listen<ActionMessage>(CHANNEL_ACTION, (event) => {
            this.handleAction(event.payload);
        });

        const unlistenPanelOpened = await listen<PanelOpenedMessage>(CHANNEL_PANEL_OPENED, () => {
            this.broadcastState();
        });

        this.unlisteners_.push(unlistenAction, unlistenPanelOpened);

        this.unsubscribe_ = this.store_.subscribe(() => {
            this.broadcastState();
        });
    }

    broadcastState(): void {
        const serialized = serializeEditorState(this.store_);
        emit(CHANNEL_STATE, serialized);
    }

    broadcastOutput(text: string, type: OutputType): void {
        const msg: OutputMessage = { text, type };
        emit(CHANNEL_OUTPUT, msg);
    }

    onPanelClosed(callback: (panelId: string) => void): () => void {
        let active = true;
        let unlisten: UnlistenFn | null = null;

        listen<PanelClosedMessage>(CHANNEL_PANEL_CLOSED, (event) => {
            if (active) {
                callback(event.payload.panelId);
            }
        }).then(fn => {
            if (active) {
                unlisten = fn;
            } else {
                fn();
            }
        });

        return () => {
            active = false;
            unlisten?.();
        };
    }

    dispose(): void {
        for (const unlisten of this.unlisteners_) {
            unlisten();
        }
        this.unlisteners_ = [];
        this.unsubscribe_?.();
        this.unsubscribe_ = null;
        this.started_ = false;
    }

    private handleAction(msg: ActionMessage): void {
        try {
            const result = this.executeAction(msg);
            const response: ActionResultMessage = { id: msg.id, result };
            emit(CHANNEL_ACTION_RESULT, response);
        } catch (err) {
            const response: ActionResultMessage = {
                id: msg.id,
                error: err instanceof Error ? err.message : String(err),
            };
            emit(CHANNEL_ACTION_RESULT, response);
        }
    }

    private executeAction(msg: ActionMessage): unknown {
        const store = this.store_;
        const args = msg.args;

        switch (msg.type) {
            case 'selectEntity':
                store.selectEntity(
                    args[0] as Entity | null,
                    (args[1] as 'replace' | 'add' | 'toggle') ?? 'replace',
                );
                return undefined;

            case 'selectEntities':
                store.selectEntities(args[0] as number[]);
                return undefined;

            case 'selectAsset':
                store.selectAsset(args[0] as Parameters<typeof store.selectAsset>[0]);
                return undefined;

            case 'createEntity': {
                const entity = store.createEntity(
                    args[0] as string | undefined,
                    (args[1] as Entity | null) ?? null,
                );
                return entity;
            }

            case 'deleteEntity':
                store.deleteEntity(args[0] as Entity);
                return undefined;

            case 'deleteSelectedEntities':
                store.deleteSelectedEntities();
                return undefined;

            case 'renameEntity':
                store.renameEntity(args[0] as Entity, args[1] as string);
                return undefined;

            case 'reparentEntity':
                store.reparentEntity(args[0] as Entity, args[1] as Entity | null);
                return undefined;

            case 'moveEntity':
                store.moveEntity(args[0] as Entity, args[1] as Entity | null, args[2] as number);
                return undefined;

            case 'addComponent':
                store.addComponent(
                    args[0] as Entity,
                    args[1] as string,
                    args[2] as Record<string, unknown>,
                );
                return undefined;

            case 'removeComponent':
                store.removeComponent(args[0] as Entity, args[1] as string);
                return undefined;

            case 'reorderComponent':
                store.reorderComponent(args[0] as Entity, args[1] as number, args[2] as number);
                return undefined;

            case 'updateProperty':
                store.updateProperty(
                    args[0] as Entity,
                    args[1] as string,
                    args[2] as string,
                    args[3],
                    args[4],
                );
                return undefined;

            case 'updateProperties':
                store.updateProperties(
                    args[0] as Entity,
                    args[1] as string,
                    args[2] as { property: string; oldValue: unknown; newValue: unknown }[],
                );
                return undefined;

            case 'updatePropertyDirect':
                store.updatePropertyDirect(
                    args[0] as Entity,
                    args[1] as string,
                    args[2] as string,
                    args[3],
                );
                return undefined;

            case 'toggleVisibility':
                store.toggleVisibility(args[0] as number);
                return undefined;

            case 'undo':
                store.undo();
                return undefined;

            case 'redo':
                store.redo();
                return undefined;

            default:
                throw new Error(`Unknown action type: ${msg.type}`);
        }
    }
}
