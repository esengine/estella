import { defineComponent } from '../component';
import { defineResource } from '../resource';
import type { Entity } from '../types';

export interface FocusableData {
    tabIndex: number;
    isFocused: boolean;
}

export const Focusable = defineComponent<FocusableData>('Focusable', {
    tabIndex: 0,
    isFocused: false,
});

export class FocusManagerState {
    focusedEntity: Entity | null = null;

    focus(entity: Entity): Entity | null {
        const prev = this.focusedEntity;
        this.focusedEntity = entity;
        return prev;
    }

    blur(): Entity | null {
        const prev = this.focusedEntity;
        this.focusedEntity = null;
        return prev;
    }
}

export const FocusManager = defineResource<FocusManagerState>(
    new FocusManagerState(), 'FocusManager'
);
