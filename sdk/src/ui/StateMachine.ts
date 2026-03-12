import { defineComponent } from '../component';

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

export interface StateNode {
    timeline?: string;
    timelineWrapMode?: 'once' | 'loop';
    properties?: Record<string, unknown>;
    transitions: Transition[];
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

export interface StateMachineData {
    states: Record<string, StateNode>;
    inputs: InputDef[];
    listeners: ListenerDef[];
    initialState: string;
}

export const StateMachine = defineComponent<StateMachineData>('StateMachine', {
    states: {},
    inputs: [],
    listeners: [],
    initialState: '',
});
