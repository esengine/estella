import { defineComponent } from '../component';
import type { Color } from '../types';

export interface TextInputData {
    value: string;
    placeholder: string;
    placeholderColor: Color;
    fontFamily: string;
    fontSize: number;
    color: Color;
    backgroundColor: Color;
    padding: number;
    maxLength: number;
    multiline: boolean;
    password: boolean;
    readOnly: boolean;
    focused: boolean;
    cursorPos: number;
    dirty: boolean;
}

export const TextInput = defineComponent<TextInputData>('TextInput', {
    value: '',
    placeholder: '',
    placeholderColor: { r: 0.6, g: 0.6, b: 0.6, a: 1 },
    fontFamily: 'Arial',
    fontSize: 16,
    color: { r: 1, g: 1, b: 1, a: 1 },
    backgroundColor: { r: 0.15, g: 0.15, b: 0.15, a: 1 },
    padding: 6,
    maxLength: 0,
    multiline: false,
    password: false,
    readOnly: false,
    focused: false,
    cursorPos: 0,
    dirty: true,
});
