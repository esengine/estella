import type { Color } from '../types';
import type { RichTextRun, ImageValign } from './RichTextParser';
import { isWordChar } from './uiHelpers';

export interface FontSet {
    fonts: [string, string, string, string];
}

export interface TextPositionedRun {
    type: 'text';
    text: string;
    x: number;
    width: number;
    fontIndex: number;
    color: Color;
}

export interface ImagePositionedRun {
    type: 'image';
    src: string;
    x: number;
    width: number;
    height: number;
    valign: ImageValign;
    offsetX: number;
    offsetY: number;
    tint: Color | null;
}

export type PositionedRun = TextPositionedRun | ImagePositionedRun;

export interface LayoutLine {
    runs: PositionedRun[];
    width: number;
    height?: number;
}

export function createFontSet(size: number, family: string): FontSet {
    return {
        fonts: [
            `${size}px ${family}`,
            `bold ${size}px ${family}`,
            `italic ${size}px ${family}`,
            `italic bold ${size}px ${family}`,
        ],
    };
}

export function fontIndex(bold: boolean, italic: boolean): number {
    return (bold ? 1 : 0) | (italic ? 2 : 0);
}

export function measureLayoutWidth(lines: LayoutLine[]): number {
    let max = 0;
    for (const line of lines) {
        if (line.width > max) max = line.width;
    }
    return max;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function appendTextRun(
    line: PositionedRun[], lineWidth: number,
    text: string, width: number, fi: number, color: Color,
): number {
    line.push({ type: 'text', text, x: lineWidth, width, fontIndex: fi, color });
    return lineWidth + width;
}

function finishLine(runs: PositionedRun[], width: number): LayoutLine {
    return { runs, width };
}

function breakRun(
    ctx: Ctx, text: string, available: number,
): { fit: string; rest: string } {
    if (ctx.measureText(text).width <= available) {
        return { fit: text, rest: '' };
    }

    let breakPos = 0;
    for (let j = 0; j < text.length; j++) {
        if (ctx.measureText(text.slice(0, j + 1)).width > available) break;
        breakPos = j + 1;
    }

    if (breakPos === 0) {
        return { fit: '', rest: text };
    }

    const charAfter = text.charCodeAt(breakPos);
    if (breakPos < text.length && isWordChar(charAfter)) {
        const lastFitChar = text.charCodeAt(breakPos - 1);
        if (isWordChar(lastFitChar)) {
            let wordBreak = -1;
            for (let j = breakPos - 1; j >= 0; j--) {
                if (!isWordChar(text.charCodeAt(j))) {
                    wordBreak = j + 1;
                    break;
                }
            }
            if (wordBreak > 0) {
                return { fit: text.slice(0, wordBreak), rest: text.slice(wordBreak) };
            }
        }
    }

    return { fit: text.slice(0, breakPos), rest: text.slice(breakPos) };
}

export function layoutRichText(
    ctx: Ctx,
    runs: RichTextRun[],
    fontSet: FontSet,
    baseColor: Color,
    maxWidth: number,
    fontSize: number = 16,
): LayoutLine[] {
    const lines: LayoutLine[] = [];
    let currentRuns: PositionedRun[] = [];
    let lineWidth = 0;
    let lastFI = -1;

    let lineMaxImgH = 0;

    function emitLine(): void {
        const line = finishLine(currentRuns, lineWidth);
        if (lineMaxImgH > 0) line.height = lineMaxImgH;
        lines.push(line);
        currentRuns = [];
        lineWidth = 0;
        lineMaxImgH = 0;
    }

    for (const run of runs) {
        if (run.type === 'image') {
            const s = run.scale;
            const imgW = (run.width || fontSize) * s;
            const imgH = (run.height || fontSize) * s;
            if (maxWidth > 0 && lineWidth + imgW > maxWidth && currentRuns.length > 0) {
                emitLine();
            }
            currentRuns.push({
                type: 'image', src: run.src, x: lineWidth,
                width: imgW, height: imgH, valign: run.valign,
                offsetX: run.offsetX, offsetY: run.offsetY, tint: run.tint,
            });
            lineWidth += imgW;
            if (imgH > lineMaxImgH) lineMaxImgH = imgH;
            continue;
        }
        const fi = fontIndex(run.bold, run.italic);
        if (fi !== lastFI) {
            ctx.font = fontSet.fonts[fi];
            lastFI = fi;
        }
        const color = run.color ?? baseColor;

        const parts = run.text.split('\n');
        for (let p = 0; p < parts.length; p++) {
            if (p > 0) emitLine();

            const part = parts[p];
            if (!part) continue;

            if (maxWidth <= 0) {
                const w = ctx.measureText(part).width;
                lineWidth = appendTextRun(currentRuns, lineWidth, part, w, fi, color);
                continue;
            }

            let remaining = part;
            while (remaining) {
                const available = maxWidth - lineWidth;
                const { fit, rest } = breakRun(ctx, remaining, available);

                if (fit) {
                    const w = ctx.measureText(fit).width;
                    lineWidth = appendTextRun(currentRuns, lineWidth, fit, w, fi, color);
                }

                if (rest) {
                    if (!fit && currentRuns.length === 0) {
                        const oneChar = remaining[0];
                        const w = ctx.measureText(oneChar).width;
                        lineWidth = appendTextRun(currentRuns, lineWidth, oneChar, w, fi, color);
                        remaining = remaining.slice(1);
                    }
                    emitLine();
                    remaining = rest;
                    if (fi !== lastFI) {
                        ctx.font = fontSet.fonts[fi];
                        lastFI = fi;
                    }
                } else {
                    remaining = '';
                }
            }
        }
    }

    if (currentRuns.length > 0 || lines.length === 0) {
        emitLine();
    }

    return lines;
}
