import type { Color } from '../types';

export interface TextRun {
    text: string;
    bold: boolean;
    italic: boolean;
    color: Color | null;
}

interface StyleFrame {
    bold: boolean;
    italic: boolean;
    color: Color | null;
}

const TAG_COLOR_RE = /^color=(#[0-9a-fA-F]{6,8})$/;

function parseHexColor(hex: string): Color | null {
    if (hex.length !== 7 && hex.length !== 9) return null;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const a = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) : 255;
    if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) return null;
    return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
}

function emitRun(runs: TextRun[], text: string, style: StyleFrame): void {
    if (text.length === 0) return;
    runs.push({ text, bold: style.bold, italic: style.italic, color: style.color });
}

export function parseRichText(input: string): TextRun[] {
    const runs: TextRun[] = [];
    if (!input) return runs;

    const stack: StyleFrame[] = [{ bold: false, italic: false, color: null }];
    let buffer = '';
    let i = 0;

    while (i < input.length) {
        if (input[i] !== '<') {
            buffer += input[i];
            i++;
            continue;
        }

        const closeIdx = input.indexOf('>', i + 1);
        if (closeIdx === -1) {
            buffer += input[i];
            i++;
            continue;
        }

        const tagContent = input.slice(i + 1, closeIdx);
        const current = stack[stack.length - 1];

        if (tagContent === 'b') {
            emitRun(runs, buffer, current);
            buffer = '';
            stack.push({ ...current, bold: true });
        } else if (tagContent === 'i') {
            emitRun(runs, buffer, current);
            buffer = '';
            stack.push({ ...current, italic: true });
        } else if (tagContent === '/b' || tagContent === '/i' || tagContent === '/color') {
            emitRun(runs, buffer, current);
            buffer = '';
            if (stack.length > 1) stack.pop();
        } else {
            const colorMatch = tagContent.match(TAG_COLOR_RE);
            const parsed = colorMatch ? parseHexColor(colorMatch[1]) : null;
            if (parsed) {
                emitRun(runs, buffer, current);
                buffer = '';
                stack.push({ ...current, color: parsed });
            } else {
                buffer += input.slice(i, closeIdx + 1);
                i = closeIdx + 1;
                continue;
            }
        }

        i = closeIdx + 1;
    }

    emitRun(runs, buffer, stack[stack.length - 1]);
    return runs;
}
