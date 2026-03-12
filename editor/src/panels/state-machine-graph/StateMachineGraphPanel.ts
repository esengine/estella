import type { PanelInstance } from '../PanelRegistry';
import type { EditorStore } from '../../store/EditorStore';
import { getPlayModeService } from '../../services/PlayModeService';
import { GraphCanvas } from './GraphCanvas';
import { createGraphState } from './GraphState';
import {
    NODE_WIDTH,
    NODE_HEIGHT,
    ENTRY_NODE_WIDTH,
    ENTRY_NODE_HEIGHT,
    AUTO_LAYOUT_SPACING_X,
    AUTO_LAYOUT_SPACING_Y,
    AUTO_LAYOUT_START_X,
    AUTO_LAYOUT_START_Y,
} from './graphConstants';

interface StateMachineStates {
    [name: string]: {
        timeline?: string;
        properties?: Record<string, unknown>;
        transitions: Array<{ target: string; conditions: unknown[]; duration: number }>;
    };
}

interface StateMachineComponentData {
    states: StateMachineStates;
    initialState: string;
    _editorLayout?: Record<string, { x: number; y: number }>;
}

export class StateMachineGraphPanel implements PanelInstance {
    private container_: HTMLElement;
    private store_: EditorStore;
    private graphCanvas_: GraphCanvas | null = null;
    private graphState_ = createGraphState();
    private wrapper_: HTMLElement;
    private canvasContainer_: HTMLElement;
    private emptyEl_: HTMLElement;
    private unsubscribe_: (() => void) | null = null;
    private disposePlayMode_: (() => void) | null = null;
    private currentEntityId_: number | null = null;
    private pendingLayoutSave_: Record<string, { x: number; y: number }> | null = null;

    constructor(container: HTMLElement, store: EditorStore) {
        this.container_ = container;
        this.store_ = store;

        this.wrapper_ = document.createElement('div');
        this.wrapper_.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;background:#1e1e1e;';
        container.appendChild(this.wrapper_);

        this.emptyEl_ = document.createElement('div');
        this.emptyEl_.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#666;font-size:13px;';
        this.emptyEl_.textContent = 'Select an entity with a StateMachine component';
        this.wrapper_.appendChild(this.emptyEl_);

        this.canvasContainer_ = document.createElement('div');
        this.canvasContainer_.style.cssText = 'flex:1;min-height:0;position:relative;display:none;overflow:hidden;';
        this.wrapper_.appendChild(this.canvasContainer_);

        this.unsubscribe_ = store.subscribe((_state, dirtyFlags) => {
            if (!dirtyFlags || dirtyFlags.has('selection') || dirtyFlags.has('scene')) {
                this.refresh();
            }
        });

        this.disposePlayMode_ = getPlayModeService().onStateChange((state) => {
            this.graphState_.isPlayMode = state === 'playing';
            if (!this.graphState_.isPlayMode) {
                this.graphState_.activeStateName = null;
            }
            this.graphCanvas_?.draw();
        });

        this.refresh();
    }

    dispose(): void {
        this.unsubscribe_?.();
        this.disposePlayMode_?.();
        this.graphCanvas_?.dispose();
        this.container_.innerHTML = '';
    }

    resize(): void {
        this.graphCanvas_?.draw();
    }

    private refresh(): void {
        const smData = this.findStateMachineData();

        if (!smData) {
            this.emptyEl_.style.display = 'flex';
            this.canvasContainer_.style.display = 'none';
            this.currentEntityId_ = null;
            return;
        }

        this.emptyEl_.style.display = 'none';
        this.canvasContainer_.style.display = 'block';

        if (!this.graphCanvas_) {
            this.graphCanvas_ = new GraphCanvas(this.canvasContainer_, this.graphState_, {
                onNodeDragged: (name, x, y) => {
                    if (!this.pendingLayoutSave_) {
                        this.pendingLayoutSave_ = {};
                    }
                    this.pendingLayoutSave_[name] = { x, y };
                },
                onNodeDragEnd: () => {
                    if (this.pendingLayoutSave_ && this.currentEntityId_ !== null) {
                        this.saveEditorLayout(this.pendingLayoutSave_);
                        this.pendingLayoutSave_ = null;
                    }
                },
                onConnectionCreated: (from, to) => {
                    this.createTransition(from, to);
                },
                onDeleteSelection: () => {
                    this.deleteSelection();
                },
                onAddState: (worldX, worldY) => {
                    this.addState(worldX, worldY);
                },
                onRenameNode: (name) => {
                    this.promptRename(name);
                },
                onSelectionChanged: () => {},
            });
        }

        this.syncGraphState(smData);
        this.graphCanvas_.draw();
    }

    private findStateMachineData(): StateMachineComponentData | null {
        const selected = this.store_.selectedEntities;
        if (selected.size === 0) return null;

        const entityId = selected.values().next().value as number;
        const entity = this.store_.getEntityData(entityId);
        if (!entity) return null;

        const smComp = entity.components.find(
            (c: { type: string }) => c.type === 'StateMachine',
        );
        if (!smComp) return null;

        this.currentEntityId_ = entityId;
        return smComp.data as unknown as StateMachineComponentData;
    }

    private syncGraphState(data: StateMachineComponentData): void {
        const layouts = this.graphState_.nodeLayouts;
        const editorLayout = data._editorLayout ?? {};
        const stateNames = Object.keys(data.states);

        this.graphState_.initialStateName = data.initialState || null;

        const existingKeys = new Set(layouts.keys());
        const neededKeys = new Set<string>(['__entry__', ...stateNames]);

        for (const key of existingKeys) {
            if (!neededKeys.has(key)) {
                layouts.delete(key);
            }
        }

        if (!layouts.has('__entry__')) {
            const saved = editorLayout['__entry__'];
            layouts.set('__entry__', {
                x: saved?.x ?? 20,
                y: saved?.y ?? AUTO_LAYOUT_START_Y,
                width: ENTRY_NODE_WIDTH,
                height: ENTRY_NODE_HEIGHT,
            });
        }

        this.graphCanvas_?.clearSubtitles();
        this.graphState_.transitions = [];
        let autoIdx = 0;
        for (const name of stateNames) {
            if (!layouts.has(name)) {
                const saved = editorLayout[name];
                layouts.set(name, {
                    x: saved?.x ?? AUTO_LAYOUT_START_X + autoIdx * AUTO_LAYOUT_SPACING_X,
                    y: saved?.y ?? AUTO_LAYOUT_START_Y + (autoIdx % 2) * AUTO_LAYOUT_SPACING_Y,
                    width: NODE_WIDTH,
                    height: NODE_HEIGHT,
                });
                autoIdx++;
            }

            const stateData = data.states[name];
            let subtitle = '';
            if (stateData.timeline) {
                const parts = stateData.timeline.split('/');
                subtitle = parts[parts.length - 1];
            } else if (stateData.properties) {
                const count = Object.keys(stateData.properties).length;
                subtitle = count > 0 ? `${count} properties` : '';
            }
            this.graphCanvas_?.setNodeSubtitle(name, subtitle);

            if (stateData.transitions) {
                for (let i = 0; i < stateData.transitions.length; i++) {
                    const t = stateData.transitions[i];
                    if (t.target) {
                        this.graphState_.transitions.push({ from: name, target: t.target, index: i });
                    }
                }
            }
        }
    }

    // =========================================================================
    // Data Mutations
    // =========================================================================

    private createTransition(from: string, to: string): void {
        if (this.currentEntityId_ === null) return;

        const smData = this.findStateMachineData();
        if (!smData || !smData.states[from]) return;

        const oldStates = JSON.parse(JSON.stringify(smData.states));
        const newStates = JSON.parse(JSON.stringify(smData.states));

        if (!newStates[from].transitions) {
            newStates[from].transitions = [];
        }
        newStates[from].transitions.push({
            target: to,
            conditions: [],
            duration: 0,
        });

        this.store_.updateProperty(
            this.currentEntityId_,
            'StateMachine',
            'states',
            oldStates,
            newStates,
        );
    }

    private deleteSelection(): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;

        const sel = this.graphState_;

        if (sel.selectedTransition) {
            const { from, index } = sel.selectedTransition;
            if (smData.states[from]?.transitions?.[index]) {
                const oldStates = JSON.parse(JSON.stringify(smData.states));
                const newStates = JSON.parse(JSON.stringify(smData.states));
                newStates[from].transitions.splice(index, 1);

                this.store_.updateProperty(
                    this.currentEntityId_,
                    'StateMachine',
                    'states',
                    oldStates,
                    newStates,
                );
                sel.selectedTransition = null;
            }
            return;
        }

        if (sel.selectedNodes.size > 0) {
            const toDelete = new Set(sel.selectedNodes);
            toDelete.delete('__entry__');
            if (toDelete.size === 0) return;

            const oldStates = JSON.parse(JSON.stringify(smData.states));
            const newStates = JSON.parse(JSON.stringify(smData.states));

            for (const name of toDelete) {
                delete newStates[name];
            }

            for (const state of Object.values(newStates) as Array<{ transitions: Array<{ target: string }> }>) {
                if (state.transitions) {
                    state.transitions = state.transitions.filter(
                        (t: { target: string }) => !toDelete.has(t.target),
                    );
                }
            }

            this.store_.updateProperty(
                this.currentEntityId_,
                'StateMachine',
                'states',
                oldStates,
                newStates,
            );

            if (toDelete.has(smData.initialState)) {
                const remaining = Object.keys(newStates);
                this.store_.updateProperty(
                    this.currentEntityId_,
                    'StateMachine',
                    'initialState',
                    smData.initialState,
                    remaining[0] ?? '',
                );
            }

            sel.selectedNodes.clear();
        }
    }

    private addState(worldX: number, worldY: number): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;

        let name = 'newState';
        let counter = 1;
        while (smData.states[name]) {
            name = `newState${counter++}`;
        }

        const oldStates = JSON.parse(JSON.stringify(smData.states));
        const newStates = JSON.parse(JSON.stringify(smData.states));
        newStates[name] = { transitions: [] };

        this.store_.updateProperty(
            this.currentEntityId_,
            'StateMachine',
            'states',
            oldStates,
            newStates,
        );

        const oldLayout = smData._editorLayout ?? {};
        const newLayout = { ...oldLayout, [name]: { x: Math.round(worldX), y: Math.round(worldY) } };
        this.store_.updateProperty(
            this.currentEntityId_,
            'StateMachine',
            '_editorLayout',
            oldLayout,
            newLayout,
        );

        if (!smData.initialState) {
            this.store_.updateProperty(
                this.currentEntityId_,
                'StateMachine',
                'initialState',
                '',
                name,
            );
        }
    }

    private promptRename(oldName: string): void {
        const newName = prompt('Rename state:', oldName);
        if (!newName || newName === oldName) return;

        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData || !smData.states[oldName]) return;
        if (smData.states[newName]) return;

        const oldStates = JSON.parse(JSON.stringify(smData.states));
        const newStates = JSON.parse(JSON.stringify(smData.states));

        newStates[newName] = newStates[oldName];
        delete newStates[oldName];

        for (const state of Object.values(newStates) as Array<{ transitions: Array<{ target: string }> }>) {
            if (state.transitions) {
                for (const t of state.transitions) {
                    if (t.target === oldName) {
                        t.target = newName;
                    }
                }
            }
        }

        this.store_.updateProperty(
            this.currentEntityId_,
            'StateMachine',
            'states',
            oldStates,
            newStates,
        );

        if (smData.initialState === oldName) {
            this.store_.updateProperty(
                this.currentEntityId_,
                'StateMachine',
                'initialState',
                oldName,
                newName,
            );
        }

        const oldLayout = smData._editorLayout ?? {};
        if (oldLayout[oldName]) {
            const newLayout = { ...oldLayout, [newName]: oldLayout[oldName] };
            delete newLayout[oldName];
            this.store_.updateProperty(
                this.currentEntityId_,
                'StateMachine',
                '_editorLayout',
                oldLayout,
                newLayout,
            );
        }

        this.graphState_.selectedNodes.delete(oldName);
        this.graphState_.selectedNodes.add(newName);
        const layout = this.graphState_.nodeLayouts.get(oldName);
        if (layout) {
            this.graphState_.nodeLayouts.delete(oldName);
            this.graphState_.nodeLayouts.set(newName, layout);
        }
    }

    private saveEditorLayout(updates: Record<string, { x: number; y: number }>): void {
        if (this.currentEntityId_ === null) return;

        const smData = this.findStateMachineData();
        if (!smData) return;

        const oldLayout = smData._editorLayout ?? {};
        const newLayout = { ...oldLayout };
        for (const [name, pos] of Object.entries(updates)) {
            newLayout[name] = { x: Math.round(pos.x), y: Math.round(pos.y) };
        }

        this.store_.updateProperty(
            this.currentEntityId_,
            'StateMachine',
            '_editorLayout',
            oldLayout,
            newLayout,
        );
    }
}
