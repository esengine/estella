import { defineBuiltin } from '../../component';

export interface StateMachineData {
    current: string;
    previous: string;
}

export const StateMachine = defineBuiltin<StateMachineData>('StateMachine', {
    current: '',
    previous: '',
});
