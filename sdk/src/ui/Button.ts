import { defineComponent } from '../component';
import type { Color } from '../types';

export enum ButtonState {
    Normal = 0,
    Hovered = 1,
    Pressed = 2,
    Disabled = 3,
}

export interface ButtonTransition {
    normalColor: Color;
    hoveredColor: Color;
    pressedColor: Color;
    disabledColor: Color;
}

export interface ButtonData {
    state: ButtonState;
    transition: ButtonTransition | null;
}

export const Button = defineComponent<ButtonData>('Button', {
    state: ButtonState.Normal,
    transition: null,
});
