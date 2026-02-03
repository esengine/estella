/**
 * @file    text.ts
 * @brief   Text component definition for UI text rendering
 */

import { defineComponent } from '../component';
import type { Vec4 } from '../types';

// =============================================================================
// Text Alignment Enums
// =============================================================================

export enum TextAlign {
    Left = 0,
    Center = 1,
    Right = 2,
}

export enum TextBaseline {
    Top = 0,
    Middle = 1,
    Bottom = 2,
}

// =============================================================================
// Text Component Data
// =============================================================================

export interface TextData {
    content: string;
    fontFamily: string;
    fontSize: number;
    color: Vec4;
    align: TextAlign;
    baseline: TextBaseline;
    maxWidth: number;
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
    color: { x: 1, y: 1, z: 1, w: 1 },
    align: TextAlign.Left,
    baseline: TextBaseline.Top,
    maxWidth: 0,
    lineHeight: 1.2,
    dirty: true,
});
