import { defineComponent, type AssetRef } from '../component';

export interface Condition {
    inputName: string;
    comparator: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte';
    value: boolean | number;
}

export interface Transition {
    target: string;
    conditions: Condition[];
    duration: number;
    exitTime?: number;
    easing?: string;
}

export type StateType = 'standard' | 'blend1d' | 'blendDirect';

export interface BlendEntry {
    timeline?: string;
    timelineWrapMode?: 'once' | 'loop';
    properties?: Record<string, unknown>;
    threshold?: number;
    mixValue?: number;
    mixInput?: string;
}

export interface StateNode {
    timeline?: string;
    timelineWrapMode?: 'once' | 'loop';
    properties?: Record<string, unknown>;
    transitions: Transition[];
    type?: StateType;
    blendInput?: string;
    blendStates?: BlendEntry[];
}

export interface InputDef {
    name: string;
    type: 'bool' | 'number' | 'trigger';
    defaultValue?: boolean | number;
}

export interface ListenerDef {
    event: 'pointerEnter' | 'pointerExit' | 'pointerDown' | 'pointerUp';
    inputName: string;
    action: 'set' | 'reset' | 'toggle';
    value?: boolean | number;
}

export interface LayerData {
    name: string;
    states: Record<string, StateNode>;
    initialState: string;
}

export interface StateMachineData {
    states: Record<string, StateNode>;
    inputs: InputDef[];
    listeners: ListenerDef[];
    initialState: string;
    layers?: LayerData[];
}

export const StateMachine = defineComponent<StateMachineData>('StateMachine', {
    states: {},
    inputs: [],
    listeners: [],
    initialState: '',
}, {
    discoverAssets(data) {
        const refs: AssetRef[] = [];
        const states = data.states as Record<string, { timeline?: string }> | undefined;
        if (states) {
            for (const state of Object.values(states)) {
                if (typeof state.timeline === 'string' && state.timeline) {
                    refs.push({ type: 'timeline', path: state.timeline });
                }
            }
        }
        return refs;
    },
});
