import { defineResource } from '../resource';
import type { Color, Vec2 } from '../types';
import type { ColorTransition } from './uiTypes';

export interface UITheme {
    primary: Color;
    secondary: Color;
    background: Color;
    surface: Color;
    error: Color;
    text: Color;
    textSecondary: Color;
    border: Color;

    fontFamily: string;
    fontSize: {
        xs: number;
        sm: number;
        md: number;
        lg: number;
        xl: number;
    };

    spacing: {
        xs: number;
        sm: number;
        md: number;
        lg: number;
        xl: number;
    };

    button: {
        height: number;
        color: Color;
        textColor: Color;
        transition: ColorTransition;
    };
    slider: {
        trackHeight: number;
        trackColor: Color;
        fillColor: Color;
        handleSize: number;
        handleColor: Color;
    };
    toggle: {
        size: Vec2;
        onColor: Color;
        offColor: Color;
        checkColor: Color;
    };
    input: {
        height: number;
        backgroundColor: Color;
        textColor: Color;
        placeholderColor: Color;
        fontSize: number;
        padding: number;
    };
    dropdown: {
        height: number;
        backgroundColor: Color;
        itemHeight: number;
    };
    panel: {
        backgroundColor: Color;
        padding: number;
    };
    scrollView: {
        backgroundColor: Color;
    };
}

export const DARK_THEME: UITheme = {
    primary: { r: 0.25, g: 0.56, b: 0.96, a: 1 },
    secondary: { r: 0.4, g: 0.4, b: 0.4, a: 1 },
    background: { r: 0.08, g: 0.08, b: 0.08, a: 1 },
    surface: { r: 0.14, g: 0.14, b: 0.14, a: 1 },
    error: { r: 0.9, g: 0.2, b: 0.2, a: 1 },
    text: { r: 0.93, g: 0.93, b: 0.93, a: 1 },
    textSecondary: { r: 0.6, g: 0.6, b: 0.6, a: 1 },
    border: { r: 0.3, g: 0.3, b: 0.3, a: 1 },
    fontFamily: 'Arial',
    fontSize: { xs: 10, sm: 12, md: 14, lg: 18, xl: 24 },
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
    button: {
        height: 36,
        color: { r: 0.25, g: 0.25, b: 0.25, a: 1 },
        textColor: { r: 0.93, g: 0.93, b: 0.93, a: 1 },
        transition: {
            normalColor: { r: 0.25, g: 0.25, b: 0.25, a: 1 },
            hoveredColor: { r: 0.30, g: 0.30, b: 0.30, a: 1 },
            pressedColor: { r: 0.18, g: 0.18, b: 0.18, a: 1 },
            disabledColor: { r: 0.15, g: 0.15, b: 0.15, a: 0.6 },
        },
    },
    slider: {
        trackHeight: 16,
        trackColor: { r: 0.15, g: 0.15, b: 0.15, a: 1 },
        fillColor: { r: 0.25, g: 0.56, b: 0.96, a: 1 },
        handleSize: 24,
        handleColor: { r: 1, g: 1, b: 1, a: 1 },
    },
    toggle: {
        size: { x: 24, y: 24 },
        onColor: { r: 0.2, g: 0.6, b: 1, a: 1 },
        offColor: { r: 0.4, g: 0.4, b: 0.4, a: 1 },
        checkColor: { r: 1, g: 1, b: 1, a: 1 },
    },
    input: {
        height: 36,
        backgroundColor: { r: 0.15, g: 0.15, b: 0.15, a: 1 },
        textColor: { r: 1, g: 1, b: 1, a: 1 },
        placeholderColor: { r: 0.6, g: 0.6, b: 0.6, a: 1 },
        fontSize: 16,
        padding: 6,
    },
    dropdown: {
        height: 32,
        backgroundColor: { r: 0.2, g: 0.2, b: 0.2, a: 1 },
        itemHeight: 28,
    },
    panel: {
        backgroundColor: { r: 0.14, g: 0.14, b: 0.14, a: 1 },
        padding: 12,
    },
    scrollView: {
        backgroundColor: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
    },
};

export const UIThemeRes = defineResource<UITheme | null>(null, 'UITheme');
