import type { Color } from '../types';

export interface ColorTransition {
    normalColor: Color;
    hoveredColor: Color;
    pressedColor: Color;
    disabledColor: Color;
}

export const FillDirection = {
    LeftToRight: 0,
    RightToLeft: 1,
    BottomToTop: 2,
    TopToBottom: 3,
} as const;

export type FillDirection = (typeof FillDirection)[keyof typeof FillDirection];
