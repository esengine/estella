import { Sprite, Parent, LocalTransform } from '../component';
import type { ParentData, SpriteData, LocalTransformData, AnyComponentDef } from '../component';
import { computeUIRectLayout, type LayoutRect } from './uiLayout';
import { INVALID_TEXTURE } from '../types';
import type { Entity, Color } from '../types';
import type { World } from '../world';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { FillDirection } from './uiTypes';
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

interface FillAnchors {
    anchorMin: { x: number; y: number };
    anchorMax: { x: number; y: number };
    offsetMin: { x: number; y: number };
    offsetMax: { x: number; y: number };
}

export function computeFillAnchors(direction: number, value: number): FillAnchors {
    switch (direction) {
        case FillDirection.RightToLeft:
            return {
                anchorMin: { x: 1 - value, y: 0 }, anchorMax: { x: 1, y: 1 },
                offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            };
        case FillDirection.BottomToTop:
            return {
                anchorMin: { x: 0, y: 0 }, anchorMax: { x: 1, y: value },
                offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            };
        case FillDirection.TopToBottom:
            return {
                anchorMin: { x: 0, y: 1 - value }, anchorMax: { x: 1, y: 1 },
                offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            };
        default:
            return {
                anchorMin: { x: 0, y: 0 }, anchorMax: { x: value, y: 1 },
                offsetMin: { x: 0, y: 0 }, offsetMax: { x: 0, y: 0 },
            };
    }
}

export function computeHandleAnchors(
    direction: number, value: number,
): { anchorMin: { x: number; y: number }; anchorMax: { x: number; y: number } } {
    switch (direction) {
        case FillDirection.RightToLeft:
            return { anchorMin: { x: 1 - value, y: 0 }, anchorMax: { x: 1 - value, y: 1 } };
        case FillDirection.BottomToTop:
            return { anchorMin: { x: 0, y: value }, anchorMax: { x: 1, y: value } };
        case FillDirection.TopToBottom:
            return { anchorMin: { x: 0, y: 1 - value }, anchorMax: { x: 1, y: 1 - value } };
        default:
            return { anchorMin: { x: value, y: 0 }, anchorMax: { x: value, y: 1 } };
    }
}

export function computeFillSize(
    direction: number, value: number, parentW: number, parentH: number,
): { x: number; y: number } {
    switch (direction) {
        case FillDirection.BottomToTop:
        case FillDirection.TopToBottom:
            return { x: parentW, y: parentH * value };
        default:
            return { x: parentW * value, y: parentH };
    }
}

export function applyDirectionalFill(
    world: World,
    fillEntity: Entity,
    direction: number,
    value: number,
): void {
    if (!world.has(fillEntity, UIRect)) return;
    const fillRect = world.get(fillEntity, UIRect) as UIRectData;
    const anchors = computeFillAnchors(direction, value);
    fillRect.anchorMin = anchors.anchorMin;
    fillRect.anchorMax = anchors.anchorMax;
    fillRect.offsetMin = anchors.offsetMin;
    fillRect.offsetMax = anchors.offsetMax;
    if (anchors.anchorMin.x === anchors.anchorMax.x) {
        fillRect.size = { ...fillRect.size, x: 0 };
    }
    if (anchors.anchorMin.y === anchors.anchorMax.y) {
        fillRect.size = { ...fillRect.size, y: 0 };
    }
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

export function getEntityDepth(world: World, entity: Entity): number {
    let depth = 0;
    let current = entity;
    while (world.has(current, Parent)) {
        const parentData = world.get(current, Parent) as ParentData;
        const parentEntity = parentData.entity;
        if (!world.valid(parentEntity)) break;
        depth++;
        current = parentEntity;
    }
    return depth;
}

export function getEffectiveWidth(rect: UIRectData): number {
    return rect._computedWidth ?? rect.size.x;
}

export function getEffectiveHeight(rect: UIRectData): number {
    return rect._computedHeight ?? rect.size.y;
}

export function syncFillSpriteSize(
    world: World,
    fillEntity: Entity,
    direction: number,
    normalizedValue: number,
    sliderW: number,
    sliderH: number,
): void {
    if (!world.has(fillEntity, Sprite)) return;
    const sprite = world.get(fillEntity, Sprite) as SpriteData;
    let w: number;
    let h: number;
    switch (direction) {
        case FillDirection.BottomToTop:
        case FillDirection.TopToBottom:
            w = sliderW;
            h = sliderH * normalizedValue;
            break;
        default:
            w = sliderW * normalizedValue;
            h = sliderH;
            break;
    }
    if (sprite.size.x !== w || sprite.size.y !== h) {
        sprite.size.x = w;
        sprite.size.y = h;
        world.insert(fillEntity, Sprite, sprite);
    }
}

export function walkParentChain(
    world: World, entity: Entity,
    callback: (ancestor: Entity) => boolean,
): void {
    let current = entity;
    while (world.has(current, Parent)) {
        const parentData = world.get(current, Parent) as ParentData;
        const parentEntity = parentData.entity;
        if (!world.valid(parentEntity)) break;
        if (callback(parentEntity)) return;
        current = parentEntity;
    }
}

export function ensureComponent(
    world: World, entity: Entity,
    component: AnyComponentDef, defaults?: Record<string, unknown>,
): void {
    if (!world.has(entity, component)) {
        world.insert(entity, component, defaults);
    }
}

export function layoutChildEntity(
    world: World, entity: Entity,
    parentRect: LayoutRect,
    parentOriginX: number, parentOriginY: number,
): void {
    if (!world.has(entity, UIRect)) return;
    const rect = world.get(entity, UIRect) as UIRectData;

    const result = computeUIRectLayout(
        rect.anchorMin, rect.anchorMax,
        rect.offsetMin, rect.offsetMax,
        rect.size, parentRect, rect.pivot,
    );
    const width = result.rect.right - result.rect.left;
    const height = result.rect.top - result.rect.bottom;
    rect._computedWidth = width;
    rect._computedHeight = height;

    if (world.has(entity, Sprite)) {
        const sprite = world.get(entity, Sprite) as SpriteData;
        if (sprite.size.x !== width || sprite.size.y !== height) {
            sprite.size.x = width;
            sprite.size.y = height;
            world.insert(entity, Sprite, sprite);
        }
    }

    if (!rect._layoutManaged && world.has(entity, LocalTransform)) {
        const transform = world.get(entity, LocalTransform) as LocalTransformData;
        transform.position.x = result.originX - parentOriginX;
        transform.position.y = result.originY - parentOriginY;
        world.insert(entity, LocalTransform, transform);
    }
}
