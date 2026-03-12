import type { PanelInstance } from '../PanelRegistry';
import type { EditorStore } from '../../store/EditorStore';
import { getPlayModeService } from '../../services/PlayModeService';
import { showContextMenu } from '../../ui/ContextMenu';
import { GraphCanvas } from './GraphCanvas';
import { GraphDetailPanel } from './GraphDetailPanel';
import { GraphSidePanel } from './GraphSidePanel';
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

interface Condition {
    inputName: string;
    comparator: string;
    value: boolean | number;
}

interface Transition {
    target: string;
    conditions: Condition[];
    duration: number;
    exitTime?: number;
    easing?: string;
}

interface StateNode {
    timeline?: string;
    timelineWrapMode?: 'once' | 'loop';
    properties?: Record<string, unknown>;
    transitions: Transition[];
    type?: 'standard' | 'blend1d' | 'blendDirect';
    blendInput?: string;
    blendStates?: Array<Record<string, unknown>>;
}

interface InputDef {
    name: string;
    type: 'bool' | 'number' | 'trigger';
    defaultValue?: boolean | number;
}

interface ListenerDef {
    event: string;
    inputName: string;
    action: string;
    value?: boolean | number;
}

interface LayerData {
    name: string;
    states: Record<string, StateNode>;
    initialState: string;
}

interface StateMachineComponentData {
    states: Record<string, StateNode>;
    inputs: InputDef[];
    listeners: ListenerDef[];
    initialState: string;
    layers?: LayerData[];
    _editorLayout?: Record<string, { x: number; y: number }>;
}

export class StateMachineGraphPanel implements PanelInstance {
    private container_: HTMLElement;
    private store_: EditorStore;
    private graphCanvas_: GraphCanvas | null = null;
    private graphState_ = createGraphState();
    private wrapper_: HTMLElement;
    private tabBar_: HTMLElement;
    private bodyRow_: HTMLElement;
    private canvasContainer_: HTMLElement;
    private emptyEl_: HTMLElement;
    private sidePanel_: GraphSidePanel;
    private detailPanel_: GraphDetailPanel;
    private unsubscribe_: (() => void) | null = null;
    private disposePlayMode_: (() => void) | null = null;
    private currentEntityId_: number | null = null;
    private currentLayerIndex_ = 0;
    private layerTabBar_!: HTMLElement;
    private pendingLayoutSave_: Record<string, { x: number; y: number }> | null = null;

    constructor(container: HTMLElement, store: EditorStore) {
        this.container_ = container;
        this.store_ = store;

        this.wrapper_ = document.createElement('div');
        this.wrapper_.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%;overflow:hidden;background:#1e1e1e;';
        container.appendChild(this.wrapper_);

        this.tabBar_ = document.createElement('div');
        this.tabBar_.style.cssText = 'display:none;align-items:center;height:28px;min-height:28px;padding:0 8px;gap:4px;background:var(--es-bg-tertiary, #2d2d2d);border-bottom:1px solid var(--es-border, #333);';
        this.wrapper_.appendChild(this.tabBar_);

        this.layerTabBar_ = document.createElement('div');
        this.layerTabBar_.style.cssText = 'display:none;align-items:center;height:26px;min-height:26px;padding:0 8px;gap:2px;background:var(--es-bg-tertiary, #252525);border-bottom:1px solid var(--es-border, #333);';
        this.wrapper_.appendChild(this.layerTabBar_);

        this.bodyRow_ = document.createElement('div');
        this.bodyRow_.style.cssText = 'display:flex;flex:1;min-height:0;overflow:hidden;';
        this.wrapper_.appendChild(this.bodyRow_);

        this.emptyEl_ = document.createElement('div');
        this.emptyEl_.style.cssText = 'display:none;position:absolute;inset:0;align-items:center;justify-content:center;color:#666;font-size:13px;z-index:1;';
        this.emptyEl_.textContent = 'Select an entity with a StateMachine component';
        this.bodyRow_.appendChild(this.emptyEl_);

        this.sidePanel_ = new GraphSidePanel(this.tabBar_, this.bodyRow_, {
            onAddInput: (type) => this.addInput(type),
            onRemoveInput: (index) => this.removeInput(index),
            onUpdateInput: (index, field, value) => this.updateInput(index, field, value),
            onAddListener: () => this.addListener(),
            onRemoveListener: (index) => this.removeListener(index),
            onUpdateListener: (index, field, value) => this.updateListener(index, field, value),
        });

        this.canvasContainer_ = document.createElement('div');
        this.canvasContainer_.style.cssText = 'flex:1;min-width:0;min-height:0;position:relative;display:none;overflow:hidden;';
        this.bodyRow_.appendChild(this.canvasContainer_);

        this.detailPanel_ = new GraphDetailPanel(this.bodyRow_, {
            onStateChanged: (name, field, value) => this.updateStateField(name, field, value),
            onTransitionChanged: (from, idx, field, value) => this.updateTransitionField(from, idx, field, value),
            onSelectTransition: (from, idx) => {
                this.graphState_.selectedNodes.clear();
                this.graphState_.selectedTransition = { from, index: idx };
                this.graphCanvas_?.draw();
                this.updateDetailPanel();
            },
            onAddTransitionCondition: (from, idx) => this.addTransitionCondition(from, idx),
            onRemoveTransitionCondition: (from, idx, ci) => this.removeTransitionCondition(from, idx, ci),
            onAddProperty: (name, key) => this.addStateProperty(name, key),
            onRemoveProperty: (name, key) => this.removeStateProperty(name, key),
            onRenameProperty: (name, oldKey, newKey) => this.renameStateProperty(name, oldKey, newKey),
            onPropertyValueChanged: (name, key, value) => this.updateStateProperty(name, key, value),
            onAddBlendEntry: (name) => this.addBlendEntry(name),
            onRemoveBlendEntry: (name, index) => this.removeBlendEntry(name, index),
            onUpdateBlendEntry: (name, index, field, value) => this.updateBlendEntry(name, index, field, value),
        });

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
        this.detailPanel_.dispose();
        this.sidePanel_.dispose();
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
            this.tabBar_.style.display = 'none';
            this.detailPanel_.hide();
            this.currentEntityId_ = null;
            return;
        }

        this.emptyEl_.style.display = 'none';
        this.canvasContainer_.style.display = 'block';
        this.tabBar_.style.display = 'flex';
        this.sidePanel_.update(smData.inputs ?? [], smData.listeners ?? []);

        const hasLayers = smData.layers && smData.layers.length > 0;
        this.layerTabBar_.style.display = hasLayers ? 'flex' : 'none';
        if (hasLayers) {
            this.renderLayerTabs(smData.layers!);
        }

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
                onSetInitialState: (name) => {
                    this.setInitialState(name);
                },
                onAddAnyState: (worldX, worldY) => {
                    this.addAnyState(worldX, worldY);
                },
                onAddExitState: (worldX, worldY) => {
                    this.addExitState(worldX, worldY);
                },
                onSelectionChanged: () => this.updateDetailPanel(),
            });
        }

        this.syncGraphState(smData);
        this.graphCanvas_.draw();
        this.updateDetailPanel();
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

    private getActiveLayerData(data: StateMachineComponentData): { states: Record<string, StateNode>; initialState: string } {
        if (data.layers && data.layers.length > 0) {
            const idx = Math.min(this.currentLayerIndex_, data.layers.length - 1);
            this.currentLayerIndex_ = idx;
            return data.layers[idx];
        }
        return { states: data.states, initialState: data.initialState };
    }

    private syncGraphState(data: StateMachineComponentData): void {
        const layouts = this.graphState_.nodeLayouts;
        const editorLayout = data._editorLayout ?? {};
        const layer = this.getActiveLayerData(data);
        const stateNames = Object.keys(layer.states);

        this.graphState_.initialStateName = layer.initialState || null;

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
            const isAny = name === '__any__';
            const isExit = name === '__exit__';
            const isSpecial = isAny || isExit;
            if (!layouts.has(name)) {
                const saved = editorLayout[name];
                const w = isSpecial ? ENTRY_NODE_WIDTH : NODE_WIDTH;
                const h = isSpecial ? ENTRY_NODE_HEIGHT : NODE_HEIGHT;
                layouts.set(name, {
                    x: saved?.x ?? (isSpecial ? 20 : AUTO_LAYOUT_START_X + autoIdx * AUTO_LAYOUT_SPACING_X),
                    y: saved?.y ?? (isAny ? AUTO_LAYOUT_START_Y + ENTRY_NODE_HEIGHT + 20 : isExit ? AUTO_LAYOUT_START_Y + (ENTRY_NODE_HEIGHT + 20) * 2 : AUTO_LAYOUT_START_Y + (autoIdx % 2) * AUTO_LAYOUT_SPACING_Y),
                    width: w,
                    height: h,
                });
                if (!isSpecial) autoIdx++;
            }

            const stateData = layer.states[name];
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
    // Layer-Aware State Access Helpers
    // =========================================================================

    private getActiveStates(smData: StateMachineComponentData): Record<string, StateNode> {
        if (smData.layers && smData.layers.length > 0) {
            const idx = Math.min(this.currentLayerIndex_, smData.layers.length - 1);
            return smData.layers[idx].states;
        }
        return smData.states;
    }

    private commitStates(
        smData: StateMachineComponentData,
        mutate: (states: Record<string, StateNode>) => void,
    ): void {
        if (this.currentEntityId_ === null) return;

        if (smData.layers && smData.layers.length > 0) {
            const idx = Math.min(this.currentLayerIndex_, smData.layers.length - 1);
            const oldLayers = JSON.parse(JSON.stringify(smData.layers));
            const newLayers = JSON.parse(JSON.stringify(smData.layers));
            mutate(newLayers[idx].states);
            this.store_.updateProperty(this.currentEntityId_, 'StateMachine', 'layers', oldLayers, newLayers);
        } else {
            const oldStates = JSON.parse(JSON.stringify(smData.states));
            const newStates = JSON.parse(JSON.stringify(smData.states));
            mutate(newStates);
            this.store_.updateProperty(this.currentEntityId_, 'StateMachine', 'states', oldStates, newStates);
        }
    }

    private commitInitialState(smData: StateMachineComponentData, newInitialState: string): void {
        if (this.currentEntityId_ === null) return;

        if (smData.layers && smData.layers.length > 0) {
            const idx = Math.min(this.currentLayerIndex_, smData.layers.length - 1);
            const oldLayers = JSON.parse(JSON.stringify(smData.layers));
            const newLayers = JSON.parse(JSON.stringify(smData.layers));
            const oldVal = newLayers[idx].initialState;
            newLayers[idx].initialState = newInitialState;
            this.store_.updateProperty(this.currentEntityId_, 'StateMachine', 'layers', oldLayers, newLayers);
        } else {
            this.store_.updateProperty(this.currentEntityId_, 'StateMachine', 'initialState', smData.initialState, newInitialState);
        }
    }

    // =========================================================================
    // Data Mutations
    // =========================================================================

    private createTransition(from: string, to: string): void {
        if (this.currentEntityId_ === null || from === '__exit__') return;

        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (!states[from]) return;

        this.commitStates(smData, (s) => {
            if (!s[from].transitions) s[from].transitions = [];
            s[from].transitions.push({ target: to, conditions: [], duration: 0 });
        });
    }

    private deleteSelection(): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;

        const sel = this.graphState_;
        const states = this.getActiveStates(smData);
        const layer = this.getActiveLayerData(smData);

        if (sel.selectedTransition) {
            const { from, index } = sel.selectedTransition;
            if (states[from]?.transitions?.[index]) {
                this.commitStates(smData, (s) => {
                    s[from].transitions.splice(index, 1);
                });
                sel.selectedTransition = null;
            }
            return;
        }

        if (sel.selectedNodes.size > 0) {
            const toDelete = new Set(sel.selectedNodes);
            toDelete.delete('__entry__');
            toDelete.delete('__any__');
            toDelete.delete('__exit__');
            if (toDelete.size === 0) return;

            this.commitStates(smData, (s) => {
                for (const name of toDelete) {
                    delete s[name];
                }
                for (const state of Object.values(s) as Array<{ transitions: Array<{ target: string }> }>) {
                    if (state.transitions) {
                        state.transitions = state.transitions.filter(
                            (t: { target: string }) => !toDelete.has(t.target),
                        );
                    }
                }
            });

            if (toDelete.has(layer.initialState)) {
                const remaining = Object.keys(states).filter(k => !toDelete.has(k));
                this.commitInitialState(smData, remaining[0] ?? '');
            }

            sel.selectedNodes.clear();
        }
    }

    private addState(worldX: number, worldY: number): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;

        const states = this.getActiveStates(smData);
        const layer = this.getActiveLayerData(smData);
        let name = 'newState';
        let counter = 1;
        while (states[name]) {
            name = `newState${counter++}`;
        }

        this.commitStates(smData, (s) => {
            s[name] = { transitions: [] } as unknown as StateNode;
        });

        const oldLayout = smData._editorLayout ?? {};
        const newLayout = { ...oldLayout, [name]: { x: Math.round(worldX), y: Math.round(worldY) } };
        this.store_.updateProperty(this.currentEntityId_, 'StateMachine', '_editorLayout', oldLayout, newLayout);

        if (!layer.initialState) {
            this.commitInitialState(smData, name);
        }
    }

    private addAnyState(worldX: number, worldY: number): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (states['__any__']) return;

        this.commitStates(smData, (s) => {
            s['__any__'] = { transitions: [] } as unknown as StateNode;
        });

        const oldLayout = smData._editorLayout ?? {};
        const newLayout = { ...oldLayout, __any__: { x: Math.round(worldX), y: Math.round(worldY) } };
        this.store_.updateProperty(this.currentEntityId_, 'StateMachine', '_editorLayout', oldLayout, newLayout);
    }

    private addExitState(worldX: number, worldY: number): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (states['__exit__']) return;

        this.commitStates(smData, (s) => {
            s['__exit__'] = { transitions: [] } as unknown as StateNode;
        });

        const oldLayout = smData._editorLayout ?? {};
        const newLayout = { ...oldLayout, __exit__: { x: Math.round(worldX), y: Math.round(worldY) } };
        this.store_.updateProperty(this.currentEntityId_, 'StateMachine', '_editorLayout', oldLayout, newLayout);
    }

    private setInitialState(name: string): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (!states[name]) return;

        this.commitInitialState(smData, name);
    }

    private promptRename(oldName: string): void {
        const newName = prompt('Rename state:', oldName);
        if (!newName || newName === oldName) return;

        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        const layer = this.getActiveLayerData(smData);
        const reserved = ['__entry__', '__any__', '__exit__'];
        if (!states[oldName] || states[newName] || reserved.includes(newName)) return;

        this.commitStates(smData, (s) => {
            s[newName] = s[oldName];
            delete s[oldName];
            for (const state of Object.values(s) as Array<{ transitions: Array<{ target: string }> }>) {
                if (state.transitions) {
                    for (const t of state.transitions) {
                        if (t.target === oldName) t.target = newName;
                    }
                }
            }
        });

        if (layer.initialState === oldName) {
            this.commitInitialState(smData, newName);
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

    // =========================================================================
    // Detail Panel
    // =========================================================================

    private updateDetailPanel(): void {
        const smData = this.findStateMachineData();
        if (!smData) {
            this.detailPanel_.hide();
            return;
        }

        const sel = this.graphState_;
        const states = this.getActiveStates(smData);

        if (sel.selectedTransition) {
            const { from, index } = sel.selectedTransition;
            const state = states[from];
            const t = state?.transitions?.[index];
            if (t) {
                this.detailPanel_.showTransition(from, t.target, index, t, smData.inputs ?? []);
                return;
            }
        }

        if (sel.selectedNodes.size === 1) {
            const name = sel.selectedNodes.values().next().value as string;
            if (name !== '__entry__' && states[name]) {
                this.detailPanel_.showState(name, states[name], smData.inputs ?? []);
                return;
            }
        }

        this.detailPanel_.hide();
    }

    private updateStateField(stateName: string, field: string, value: unknown): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (!states[stateName]) return;

        this.commitStates(smData, (s) => {
            (s[stateName] as unknown as Record<string, unknown>)[field] = value;
        });
    }

    private updateTransitionField(fromState: string, transitionIndex: number, field: string, value: unknown): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (!states[fromState]?.transitions?.[transitionIndex]) return;

        this.commitStates(smData, (s) => {
            const t = s[fromState].transitions[transitionIndex];
            if (field.startsWith('conditions.')) {
                const parts = field.split('.');
                const ci = parseInt(parts[1], 10);
                const prop = parts[2];
                if (t.conditions?.[ci]) {
                    (t.conditions[ci] as unknown as Record<string, unknown>)[prop] = value;
                }
            } else {
                (t as unknown as Record<string, unknown>)[field] = value;
            }
        });
    }

    private addTransitionCondition(fromState: string, transitionIndex: number): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (!states[fromState]?.transitions?.[transitionIndex]) return;

        const inputName = smData.inputs?.[0]?.name ?? '';
        this.commitStates(smData, (s) => {
            const t = s[fromState].transitions[transitionIndex];
            if (!t.conditions) t.conditions = [];
            t.conditions.push({ inputName, comparator: 'eq', value: true });
        });
    }

    private removeTransitionCondition(fromState: string, transitionIndex: number, conditionIndex: number): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (!states[fromState]?.transitions?.[transitionIndex]) return;

        this.commitStates(smData, (s) => {
            s[fromState].transitions[transitionIndex].conditions.splice(conditionIndex, 1);
        });
    }

    private addStateProperty(stateName: string, key: string): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (!states[stateName]) return;

        this.commitStates(smData, (s) => {
            if (!s[stateName].properties) s[stateName].properties = {};
            s[stateName].properties![key] = 0;
        });
    }

    private renameStateProperty(stateName: string, oldKey: string, newKey: string): void {
        if (this.currentEntityId_ === null || oldKey === newKey) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (!states[stateName]?.properties?.[oldKey]) return;

        this.commitStates(smData, (s) => {
            const props = s[stateName].properties!;
            props[newKey] = props[oldKey];
            delete props[oldKey];
        });
    }

    private removeStateProperty(stateName: string, key: string): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (!states[stateName]) return;

        this.commitStates(smData, (s) => {
            delete s[stateName].properties?.[key];
        });
    }

    private updateStateProperty(stateName: string, key: string, value: unknown): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (!states[stateName]) return;

        this.commitStates(smData, (s) => {
            if (!s[stateName].properties) s[stateName].properties = {};
            s[stateName].properties![key] = value;
        });
    }

    // =========================================================================
    // Blend Entries
    // =========================================================================

    private addBlendEntry(stateName: string): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (!states[stateName]) return;

        this.commitStates(smData, (s) => {
            if (!s[stateName].blendStates) s[stateName].blendStates = [];
            s[stateName].blendStates!.push({ threshold: 0, properties: {} });
        });
    }

    private removeBlendEntry(stateName: string, index: number): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (!states[stateName]?.blendStates?.[index]) return;

        this.commitStates(smData, (s) => {
            s[stateName].blendStates!.splice(index, 1);
        });
    }

    private updateBlendEntry(stateName: string, index: number, field: string, value: unknown): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;
        const states = this.getActiveStates(smData);
        if (!states[stateName]?.blendStates?.[index]) return;

        this.commitStates(smData, (s) => {
            (s[stateName].blendStates![index] as Record<string, unknown>)[field] = value;
        });
    }

    // =========================================================================
    // Inputs / Listeners
    // =========================================================================

    private addInput(type: 'bool' | 'number' | 'trigger'): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;

        const oldInputs = JSON.parse(JSON.stringify(smData.inputs ?? []));
        const newInputs = JSON.parse(JSON.stringify(smData.inputs ?? [])) as InputDef[];
        let name = 'newInput';
        let i = 1;
        while (newInputs.some(inp => inp.name === name)) { name = `newInput${i++}`; }
        const defaultValue = type === 'bool' ? false : 0;
        newInputs.push({ name, type, defaultValue });

        this.store_.updateProperty(this.currentEntityId_, 'StateMachine', 'inputs', oldInputs, newInputs);
    }

    private removeInput(index: number): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;

        const oldInputs = JSON.parse(JSON.stringify(smData.inputs ?? []));
        const newInputs = JSON.parse(JSON.stringify(smData.inputs ?? [])) as InputDef[];
        newInputs.splice(index, 1);

        this.store_.updateProperty(this.currentEntityId_, 'StateMachine', 'inputs', oldInputs, newInputs);
    }

    private updateInput(index: number, field: 'name' | 'type' | 'defaultValue', value: unknown): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;

        const oldInputs = JSON.parse(JSON.stringify(smData.inputs ?? []));
        const newInputs = JSON.parse(JSON.stringify(smData.inputs ?? [])) as InputDef[];
        if (!newInputs[index]) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (newInputs[index] as any)[field] = value;

        this.store_.updateProperty(this.currentEntityId_, 'StateMachine', 'inputs', oldInputs, newInputs);
    }

    private addListener(): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;

        const oldListeners = JSON.parse(JSON.stringify(smData.listeners ?? []));
        const newListeners = JSON.parse(JSON.stringify(smData.listeners ?? [])) as ListenerDef[];
        const firstInput = (smData.inputs ?? [])[0]?.name ?? '';
        newListeners.push({ event: 'pointerDown', inputName: firstInput, action: 'set' });

        this.store_.updateProperty(this.currentEntityId_, 'StateMachine', 'listeners', oldListeners, newListeners);
    }

    private removeListener(index: number): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;

        const oldListeners = JSON.parse(JSON.stringify(smData.listeners ?? []));
        const newListeners = JSON.parse(JSON.stringify(smData.listeners ?? [])) as ListenerDef[];
        newListeners.splice(index, 1);

        this.store_.updateProperty(this.currentEntityId_, 'StateMachine', 'listeners', oldListeners, newListeners);
    }

    private updateListener(index: number, field: 'event' | 'inputName' | 'action', value: string): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;

        const oldListeners = JSON.parse(JSON.stringify(smData.listeners ?? []));
        const newListeners = JSON.parse(JSON.stringify(smData.listeners ?? [])) as ListenerDef[];
        if (!newListeners[index]) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (newListeners[index] as any)[field] = value;

        this.store_.updateProperty(this.currentEntityId_, 'StateMachine', 'listeners', oldListeners, newListeners);
    }

    // =========================================================================
    // Layer Tabs
    // =========================================================================

    private renderLayerTabs(layers: LayerData[]): void {
        this.layerTabBar_.innerHTML = '';

        for (let i = 0; i < layers.length; i++) {
            const tab = document.createElement('button');
            tab.textContent = layers[i].name || `Layer ${i}`;
            const isActive = i === this.currentLayerIndex_;
            tab.style.cssText = `
                padding:2px 10px;height:22px;border:1px solid ${isActive ? '#57a5ff' : '#444'};
                border-radius:4px;background:${isActive ? '#2a4a6a' : 'transparent'};
                color:${isActive ? '#fff' : '#aaa'};font-size:11px;cursor:pointer;
                font-family:-apple-system,BlinkMacSystemFont,sans-serif;
            `;
            tab.addEventListener('click', () => {
                this.currentLayerIndex_ = i;
                this.refresh();
            });
            tab.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showLayerContextMenu(e.clientX, e.clientY, i, layers);
            });
            this.layerTabBar_.appendChild(tab);
        }

        const addBtn = document.createElement('button');
        addBtn.textContent = '+';
        addBtn.style.cssText = 'padding:2px 6px;height:22px;border:1px dashed #555;border-radius:4px;background:transparent;color:#888;font-size:11px;cursor:pointer;';
        addBtn.addEventListener('click', () => this.addLayer());
        this.layerTabBar_.appendChild(addBtn);
    }

    private showLayerContextMenu(x: number, y: number, index: number, layers: LayerData[]): void {
        const items = [
            { label: 'Rename', onClick: () => this.renameLayer(index) },
            ...(layers.length > 1 ? [{ label: 'Delete', onClick: () => this.removeLayer(index) }] : []),
        ];
        showContextMenu({ x, y, items });
    }

    private addLayer(): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData) return;

        const oldLayers = JSON.parse(JSON.stringify(smData.layers ?? []));
        const newLayers = [...oldLayers];
        let name = 'New Layer';
        let counter = 1;
        while (newLayers.some((l: LayerData) => l.name === name)) { name = `New Layer ${counter++}`; }
        newLayers.push({ name, states: {}, initialState: '' });

        this.store_.updateProperty(this.currentEntityId_, 'StateMachine', 'layers', oldLayers, newLayers);
        this.currentLayerIndex_ = newLayers.length - 1;
    }

    private removeLayer(index: number): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData?.layers || smData.layers.length <= 1) return;

        const oldLayers = JSON.parse(JSON.stringify(smData.layers));
        const newLayers = [...oldLayers];
        newLayers.splice(index, 1);

        this.store_.updateProperty(this.currentEntityId_, 'StateMachine', 'layers', oldLayers, newLayers);
        if (this.currentLayerIndex_ >= newLayers.length) {
            this.currentLayerIndex_ = newLayers.length - 1;
        }
    }

    private renameLayer(index: number): void {
        if (this.currentEntityId_ === null) return;
        const smData = this.findStateMachineData();
        if (!smData?.layers?.[index]) return;

        const newName = prompt('Rename layer:', smData.layers[index].name);
        if (!newName || newName === smData.layers[index].name) return;

        const oldLayers = JSON.parse(JSON.stringify(smData.layers));
        const newLayers = JSON.parse(JSON.stringify(smData.layers));
        newLayers[index].name = newName;

        this.store_.updateProperty(this.currentEntityId_, 'StateMachine', 'layers', oldLayers, newLayers);
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
