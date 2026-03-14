import { Sprite, Parent, Transform } from '../component';
import type { ParentData, SpriteData, TransformData, AnyComponentDef } from '../component';
import { Image } from './Image';
import type { ImageData } from './Image';
import type { Entity, Color } from '../types';
import type { World } from '../world';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { UIRenderer } from './UIRenderer';
import type { UIRendererData } from './UIRenderer';
import { FillDirection } from './uiTypes';
import type { ColorTransition } from './uiTypes';
import type { ESEngineModule, CppRegistry } from '../wasm';
import { Interactable } from './Interactable';

export interface LayoutRect {
    left: number;
    bottom: number;
    right: number;
    top: number;
}

export interface LayoutResult {
    originX: number;
    originY: number;
    width: number;
    height: number;
    rect: LayoutRect;
}

export function computeUIRectLayout(
    anchorMin: { x: number; y: number },
    anchorMax: { x: number; y: number },
    offsetMin: { x: number; y: number },
    offsetMax: { x: number; y: number },
    size: { x: number; y: number },
    parentRect: LayoutRect,
    pivot: { x: number; y: number } = { x: 0.5, y: 0.5 },
): LayoutResult {
    const parentW = parentRect.right - parentRect.left;
    const parentH = parentRect.top - parentRect.bottom;

    const aLeft = parentRect.left + anchorMin.x * parentW;
    const aRight = parentRect.left + anchorMax.x * parentW;
    const aBottom = parentRect.bottom + anchorMin.y * parentH;
    const aTop = parentRect.bottom + anchorMax.y * parentH;

    let myLeft: number;
    let myBottom: number;
    let myRight: number;
    let myTop: number;

    if (anchorMin.x === anchorMax.x) {
        myLeft = aLeft + offsetMin.x - size.x * pivot.x;
        myRight = myLeft + size.x;
    } else {
        myLeft = aLeft + offsetMin.x;
        myRight = aRight + offsetMax.x;
    }

    if (anchorMin.y === anchorMax.y) {
        myBottom = aBottom + offsetMin.y - size.y * pivot.y;
        myTop = myBottom + size.y;
    } else {
        myBottom = aBottom + offsetMin.y;
        myTop = aTop + offsetMax.y;
    }

    const width = Math.max(0, myRight - myLeft);
    const height = Math.max(0, myTop - myBottom);
    const originX = myLeft + pivot.x * width;
    const originY = myBottom + pivot.y * height;

    return {
        originX,
        originY,
        width,
        height,
        rect: { left: myLeft, bottom: myBottom, right: myRight, top: myTop },
    };
}

let module_: ESEngineModule | null = null;
let nativeRegistry_: CppRegistry | null = null;

export function initUIHelpers(module: ESEngineModule, registry: CppRegistry): void {
    module_ = module;
    nativeRegistry_ = registry;
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
            return { anchorMin: { x: 1 - value, y: 0.5 }, anchorMax: { x: 1 - value, y: 0.5 } };
        case FillDirection.BottomToTop:
            return { anchorMin: { x: 0.5, y: value }, anchorMax: { x: 0.5, y: value } };
        case FillDirection.TopToBottom:
            return { anchorMin: { x: 0.5, y: 1 - value }, anchorMax: { x: 0.5, y: 1 - value } };
        default:
            return { anchorMin: { x: value, y: 0.5 }, anchorMax: { x: value, y: 0.5 } };
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

const TINT_HOVER = 1.15;
const TINT_PRESSED = 0.75;
const TINT_DISABLED = 0.5;
const TINT_DISABLED_ALPHA = 0.6;

export function applyDefaultTint(
    baseColor: Color,
    enabled: boolean,
    pressed: boolean,
    hovered: boolean,
): Color {
    if (!enabled) {
        return {
            r: baseColor.r * TINT_DISABLED,
            g: baseColor.g * TINT_DISABLED,
            b: baseColor.b * TINT_DISABLED,
            a: baseColor.a * TINT_DISABLED_ALPHA,
        };
    }
    if (pressed) {
        return {
            r: baseColor.r * TINT_PRESSED,
            g: baseColor.g * TINT_PRESSED,
            b: baseColor.b * TINT_PRESSED,
            a: baseColor.a,
        };
    }
    if (hovered) {
        return {
            r: Math.min(1, baseColor.r * TINT_HOVER),
            g: Math.min(1, baseColor.g * TINT_HOVER),
            b: Math.min(1, baseColor.b * TINT_HOVER),
            a: baseColor.a,
        };
    }
    return { ...baseColor };
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

export function getEffectiveWidth(rect: UIRectData, entity: Entity): number {
    if (module_ && nativeRegistry_) {
        const w = module_.getUIRectComputedWidth(nativeRegistry_, entity);
        if (w > 0) return w;
    }
    return rect.size.x;
}

export function getEffectiveHeight(rect: UIRectData, entity: Entity): number {
    if (module_ && nativeRegistry_) {
        const h = module_.getUIRectComputedHeight(nativeRegistry_, entity);
        if (h > 0) return h;
    }
    return rect.size.y;
}

export function setUIRectSizeNative(entity: Entity, w: number, h: number): void {
    if (module_ && nativeRegistry_) {
        module_.setUIRectSize(nativeRegistry_, entity, w, h);
    }
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

export function makeInteractable(world: World, entity: Entity): void {
    ensureComponent(world, entity, Interactable, {
        enabled: true,
        blockRaycast: true,
        raycastTarget: true,
    });
}

export function withChildEntity(
    world: World,
    childId: Entity,
    callback: (entity: Entity) => void,
): void {
    if (childId !== 0 && world.valid(childId)) {
        callback(childId);
    }
}

function colorEquals(a: Color, b: Color): boolean {
    return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

export function setEntityColor(world: World, entity: Entity, color: Color): void {
    if (world.has(entity, Image)) {
        const img = world.get(entity, Image) as ImageData;
        if (!colorEquals(img.color, color)) {
            img.color = color;
            world.insert(entity, Image, img);
        }
    } else if (world.has(entity, Sprite)) {
        const s = world.get(entity, Sprite) as SpriteData;
        if (!colorEquals(s.color, color)) {
            s.color = color;
            world.insert(entity, Sprite, s);
        }
    } else if (world.has(entity, UIRenderer)) {
        const r = world.get(entity, UIRenderer) as UIRendererData;
        if (!colorEquals(r.color, color)) {
            r.color = color;
            world.insert(entity, UIRenderer, r);
        }
    }
}

export function setEntityEnabled(world: World, entity: Entity, enabled: boolean): void {
    if (world.has(entity, Image)) {
        const img = world.get(entity, Image) as ImageData;
        if (img.enabled !== enabled) {
            img.enabled = enabled;
            world.insert(entity, Image, img);
        }
    } else if (world.has(entity, Sprite)) {
        const s = world.get(entity, Sprite) as SpriteData;
        if (s.enabled !== enabled) {
            s.enabled = enabled;
            world.insert(entity, Sprite, s);
        }
    } else if (world.has(entity, UIRenderer)) {
        const r = world.get(entity, UIRenderer) as UIRendererData;
        if (r.enabled !== enabled) {
            r.enabled = enabled;
            world.insert(entity, UIRenderer, r);
        }
    }
}

export function colorScale(c: Color, factor: number): Color {
    return {
        r: Math.min(1, c.r * factor),
        g: Math.min(1, c.g * factor),
        b: Math.min(1, c.b * factor),
        a: c.a,
    };
}

export function colorWithAlpha(c: Color, alpha: number): Color {
    return { r: c.r, g: c.g, b: c.b, a: alpha };
}

export function colorToRgba(c: Color): string {
    return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${c.a})`;
}

export class EntityStateMap<T> {
    private map_ = new Map<Entity, T>();

    get(entity: Entity): T | undefined { return this.map_.get(entity); }
    set(entity: Entity, state: T): void { this.map_.set(entity, state); }
    delete(entity: Entity): void { this.map_.delete(entity); }
    has(entity: Entity): boolean { return this.map_.has(entity); }

    cleanup(world: World): void {
        for (const [e] of this.map_) {
            if (!world.valid(e)) this.map_.delete(e);
        }
    }

    ensureInit(entity: Entity, init: () => T): T {
        let state = this.map_.get(entity);
        if (!state) {
            state = init();
            this.map_.set(entity, state);
        }
        return state;
    }

    clear(): void { this.map_.clear(); }

    [Symbol.iterator]() { return this.map_[Symbol.iterator](); }
}

