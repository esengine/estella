import type { Color } from '../types';

export interface TextSegment {
    type: 'text';
    text: string;
    bold: boolean;
    italic: boolean;
    color: Color | null;
}

export type ImageValign = 'baseline' | 'middle' | 'top' | 'bottom';

export interface ImageSegment {
    type: 'image';
    src: string;
    width: number;
    height: number;
    valign: ImageValign;
    offsetX: number;
    offsetY: number;
    scale: number;
    tint: Color | null;
}

export type RichTextRun = TextSegment | ImageSegment;

export interface TextRun extends TextSegment {}

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

function emitTextRun(runs: RichTextRun[], text: string, style: StyleFrame): void {
    if (text.length === 0) return;
    runs.push({ type: 'text', text, bold: style.bold, italic: style.italic, color: style.color });
}

const IMG_ATTR_RE = /(\w+)\s*=\s*(?:"([^"]*)"|(\S+))/g;
const VALID_VALIGNS = new Set<ImageValign>(['baseline', 'middle', 'top', 'bottom']);

function parseImgTag(tagContent: string): ImageSegment | null {
    const attrs = new Map<string, string>();
    let m: RegExpExecArray | null;
    IMG_ATTR_RE.lastIndex = 0;
    while ((m = IMG_ATTR_RE.exec(tagContent)) !== null) {
        attrs.set(m[1], m[2] ?? m[3]);
    }
    const src = attrs.get('src');
    if (!src) return null;
    const w = parseInt(attrs.get('width') ?? '0', 10);
    const h = parseInt(attrs.get('height') ?? '0', 10);
    const rawValign = attrs.get('valign') as ImageValign | undefined;
    const valign = rawValign && VALID_VALIGNS.has(rawValign) ? rawValign : 'baseline';
    const ox = parseFloat(attrs.get('offsetX') ?? '0');
    const oy = parseFloat(attrs.get('offsetY') ?? '0');
    const scale = parseFloat(attrs.get('scale') ?? '1');
    const tintStr = attrs.get('tint');
    const tint = tintStr ? parseHexColor(tintStr) : null;
    return {
        type: 'image', src,
        width: isNaN(w) ? 0 : w, height: isNaN(h) ? 0 : h,
        valign,
        offsetX: isNaN(ox) ? 0 : ox,
        offsetY: isNaN(oy) ? 0 : oy,
        scale: isNaN(scale) || scale <= 0 ? 1 : scale,
        tint,
    };
}

export function parseRichText(input: string): RichTextRun[] {
    const runs: RichTextRun[] = [];
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
            emitTextRun(runs, buffer, current);
            buffer = '';
            stack.push({ ...current, bold: true });
        } else if (tagContent === 'i') {
            emitTextRun(runs, buffer, current);
            buffer = '';
            stack.push({ ...current, italic: true });
        } else if (tagContent === '/b' || tagContent === '/i' || tagContent === '/color') {
            emitTextRun(runs, buffer, current);
            buffer = '';
            if (stack.length > 1) stack.pop();
        } else if (tagContent.startsWith('img ') && tagContent.endsWith('/')) {
            const img = parseImgTag(tagContent.slice(0, -1));
            if (img) {
                emitTextRun(runs, buffer, current);
                buffer = '';
                runs.push(img);
            } else {
                buffer += input.slice(i, closeIdx + 1);
                i = closeIdx + 1;
                continue;
            }
        } else {
            const colorMatch = tagContent.match(TAG_COLOR_RE);
            const parsed = colorMatch ? parseHexColor(colorMatch[1]) : null;
            if (parsed) {
                emitTextRun(runs, buffer, current);
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

    emitTextRun(runs, buffer, stack[stack.length - 1]);
    return runs;
}
