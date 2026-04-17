import { defineComponent } from '../../component';
import type { Color } from '../../types';

export const TextAlign = {
    Left: 0,
    Center: 1,
    Right: 2,
} as const;
export type TextAlign = (typeof TextAlign)[keyof typeof TextAlign];

export const TextVerticalAlign = {
    Top: 0,
    Middle: 1,
    Bottom: 2,
} as const;
export type TextVerticalAlign = (typeof TextVerticalAlign)[keyof typeof TextVerticalAlign];

export const TextOverflow = {
    Visible: 0,
    Clip: 1,
    Ellipsis: 2,
} as const;
export type TextOverflow = (typeof TextOverflow)[keyof typeof TextOverflow];

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
    bold: boolean;
    italic: boolean;
    strokeColor: Color;
    strokeWidth: number;
    shadowColor: Color;
    shadowBlur: number;
    shadowOffsetX: number;
    shadowOffsetY: number;
    richText: boolean;
}

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
    bold: false,
    italic: false,
    strokeColor: { r: 0, g: 0, b: 0, a: 1 },
    strokeWidth: 0,
    shadowColor: { r: 0, g: 0, b: 0, a: 1 },
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    richText: false,
});
