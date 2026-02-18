import { defineComponent } from '../component';
import type { ColorTransition } from './uiTypes';

export type { ColorTransition } from './uiTypes';
export type ButtonTransition = ColorTransition;

export const ButtonState = {
    Normal: 0,
    Hovered: 1,
    Pressed: 2,
    Disabled: 3,
} as const;

export type ButtonState = (typeof ButtonState)[keyof typeof ButtonState];

export interface ButtonData {
    state: ButtonState;
    transition: ColorTransition | null;
}

export const Button = defineComponent<ButtonData>('Button', {
    state: ButtonState.Normal,
    transition: null,
});
