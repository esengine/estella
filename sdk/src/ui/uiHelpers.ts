import { Sprite } from '../component';
import { INVALID_TEXTURE } from '../types';
import type { Entity, Color } from '../types';
import type { World } from '../world';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import type { FillDirection } from './uiTypes';
import type { ColorTransition } from './uiTypes';

export function ensureSprite(world: World, entity: Entity): void {
    if (!world.has(entity, Sprite)) {
        world.insert(entity, Sprite, {
            texture: INVALID_TEXTURE,
            color: { r: 1, g: 1, b: 1, a: 1 },
            size: { x: 0, y: 0 },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            layer: 0,
            flipX: false,
            flipY: false,
            material: 0,
        });
    }
}

export function applyDirectionalFill(
    world: World,
    fillEntity: Entity,
    direction: FillDirection,
    value: number,
): void {
    if (!world.has(fillEntity, UIRect)) return;
    const fillRect = world.get(fillEntity, UIRect) as UIRectData;

    switch (direction) {
        case 0: // LeftToRight
            fillRect.anchorMin = { x: 0, y: 0 };
            fillRect.anchorMax = { x: value, y: 1 };
            break;
        case 1: // RightToLeft
            fillRect.anchorMin = { x: 1 - value, y: 0 };
            fillRect.anchorMax = { x: 1, y: 1 };
            break;
        case 2: // BottomToTop
            fillRect.anchorMin = { x: 0, y: 0 };
            fillRect.anchorMax = { x: 1, y: value };
            break;
        case 3: // TopToBottom
            fillRect.anchorMin = { x: 0, y: 1 - value };
            fillRect.anchorMax = { x: 1, y: 1 };
            break;
    }
    fillRect.offsetMin = { x: 0, y: 0 };
    fillRect.offsetMax = { x: 0, y: 0 };
    world.insert(fillEntity, UIRect, fillRect);
}

export function applyColorTransition(
    transition: ColorTransition,
    enabled: boolean,
    pressed: boolean,
    hovered: boolean,
): Color {
    if (!enabled) return { ...transition.disabledColor };
    if (pressed) return { ...transition.pressedColor };
    if (hovered) return { ...transition.hoveredColor };
    return { ...transition.normalColor };
}

function isWordChar(code: number): boolean {
    return (code >= 0x41 && code <= 0x5A)
        || (code >= 0x61 && code <= 0x7A)
        || (code >= 0x30 && code <= 0x39)
        || code === 0x5F;
}

export function wrapText(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    text: string,
    maxWidth: number,
): string[] {
    if (!text) return [''];
    if (maxWidth <= 0) return text.split('\n');
    const paragraphs = text.split('\n');
    const lines: string[] = [];
    for (const paragraph of paragraphs) {
        if (!paragraph) { lines.push(''); continue; }
        let currentLine = '';
        for (let i = 0; i < paragraph.length; i++) {
            const char = paragraph[i];
            const testLine = currentLine + char;
            if (ctx.measureText(testLine).width > maxWidth && currentLine) {
                const code = char.charCodeAt(0);
                if (isWordChar(code) && currentLine.length > 0 && isWordChar(currentLine.charCodeAt(currentLine.length - 1))) {
                    let breakPos = -1;
                    for (let j = currentLine.length - 1; j >= 0; j--) {
                        if (!isWordChar(currentLine.charCodeAt(j))) {
                            breakPos = j;
                            break;
                        }
                    }
                    if (breakPos >= 0) {
                        lines.push(currentLine.substring(0, breakPos + 1));
                        currentLine = currentLine.substring(breakPos + 1) + char;
                    } else {
                        lines.push(currentLine);
                        currentLine = char;
                    }
                } else {
                    lines.push(currentLine);
                    currentLine = char;
                }
            } else {
                currentLine = testLine;
            }
        }
        if (currentLine) lines.push(currentLine);
    }
    return lines.length > 0 ? lines : [''];
}

export function nextPowerOf2(n: number): number {
    let p = 1;
    while (p < n) p *= 2;
    return p;
}
