// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { CoreApiBridge } from '../CoreApiBridge';
import { Sprite, Parent, Transform } from '../component';
import type { ParentData, SpriteData, TransformData, AnyComponentDef } from '../component';
import type { Entity, Color } from '../types';
import type { World } from '../world';
import { UIVisual, UIVisualType } from './core/ui-visual';
import type { UIVisualData } from './core/ui-visual';
import { FillDirection } from './uiTypes';
import type { ColorTransition } from './uiTypes';
import type { ESEngineModule, CppRegistry } from '../wasm';
import { Interactable } from './behavior/interactable';

const bridge = new CoreApiBridge('uiHelpers');
let module_: ESEngineModule | null = null;
let nativeRegistry_: CppRegistry | null = null;

export function initUIHelpers(module: ESEngineModule, registry: CppRegistry): void {
    bridge.connect(module);
    module_ = bridge.module;
    nativeRegistry_ = registry;
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

export function isWordChar(code: number): boolean {
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

/** Resolved px width of a UINode (its Yoga-computed size; REARCH_GUI F3). 0 if unresolved. */
export function getUINodeWidth(entity: Entity): number {
    if (module_ && nativeRegistry_ && module_.getUINodeComputedWidth) {
        return module_.getUINodeComputedWidth(nativeRegistry_, entity);
    }
    return 0;
}

/** Resolved px height of a UINode. 0 if unresolved. */
export function getUINodeHeight(entity: Entity): number {
    if (module_ && nativeRegistry_ && module_.getUINodeComputedHeight) {
        return module_.getUINodeComputedHeight(nativeRegistry_, entity);
    }
    return 0;
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

export function ensureUIVisual(world: World, entity: Entity): void {
    if (!world.has(entity, UIVisual)) {
        world.insert(entity, UIVisual, {
            visualType: UIVisualType.None,
            texture: 0,
            color: { r: 1, g: 1, b: 1, a: 1 },
            uvOffset: { x: 0, y: 0 },
            uvScale: { x: 1, y: 1 },
            sliceBorder: { x: 0, y: 0, z: 0, w: 0 },
            tileSize: { x: 32, y: 32 },
            fillMethod: 0,
            fillOrigin: 0,
            fillAmount: 1,
            material: 0,
            enabled: true,
        });
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
    if (world.has(entity, Sprite)) {
        const s = world.get(entity, Sprite) as SpriteData;
        if (!colorEquals(s.color, color)) {
            s.color = color;
            world.insert(entity, Sprite, s);
        }
    } else if (world.has(entity, UIVisual)) {
        const r = world.get(entity, UIVisual) as UIVisualData;
        if (!colorEquals(r.color, color)) {
            r.color = color;
            world.insert(entity, UIVisual, r);
        }
    }
}

export function setEntityEnabled(world: World, entity: Entity, enabled: boolean): void {
    if (world.has(entity, Sprite)) {
        const s = world.get(entity, Sprite) as SpriteData;
        if (s.enabled !== enabled) {
            s.enabled = enabled;
            world.insert(entity, Sprite, s);
        }
    } else if (world.has(entity, UIVisual)) {
        const r = world.get(entity, UIVisual) as UIVisualData;
        if (r.enabled !== enabled) {
            r.enabled = enabled;
            world.insert(entity, UIVisual, r);
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

