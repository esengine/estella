/**
 * @file    text.ts
 * @brief   Text component definition for UI text rendering
 */

import { defineComponent } from '../component';
import type { Color } from '../types';

// =============================================================================
// Text Alignment Enums
// =============================================================================

export enum TextAlign {
    Left = 0,
    Center = 1,
    Right = 2,
}

export enum TextVerticalAlign {
    Top = 0,
    Middle = 1,
    Bottom = 2,
}

export enum TextOverflow {
    Visible = 0,
    Clip = 1,
    Ellipsis = 2,
}

// =============================================================================
// Text Component Data
// =============================================================================

export interface TextData {
    content: string;
    fontFamily: string;
    fontSize: number;
    color: Color;
    align: TextAlign;
    verticalAlign: TextVerticalAlign;
    wordWrap: boolean;
    overflow: TextOverflow;
    lineHeight: number;
    dirty: boolean;
}

// =============================================================================
// Text Component Definition
// =============================================================================

export const Text = defineComponent<TextData>('Text', {
    content: '',
    fontFamily: 'Arial',
    fontSize: 24,
    color: { r: 1, g: 1, b: 1, a: 1 },
    align: TextAlign.Left,
    verticalAlign: TextVerticalAlign.Top,
    wordWrap: true,
    overflow: TextOverflow.Visible,
    lineHeight: 1.2,
    dirty: true,
});
