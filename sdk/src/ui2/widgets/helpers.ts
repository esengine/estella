import {
    Transform,
    type TransformData,
} from '../../component';
import type { Entity, Vec2 } from '../../types';
import type { World } from '../../world';

import { UIRect, type UIRectData } from '../core/ui-rect';
import { UIRenderer, UIVisualType, type UIRendererData } from '../core/ui-renderer';
import { Text, TextAlign, TextVerticalAlign, type TextData } from '../core/text';

/** Identity Transform. Fresh object per call — safe to insert into ECS. */
export function identityTransform(): TransformData {
    return {
        position: { x: 0, y: 0, z: 0 },
        rotation: { w: 1, x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        worldPosition: { x: 0, y: 0, z: 0 },
        worldRotation: { w: 1, x: 0, y: 0, z: 0 },
        worldScale: { x: 1, y: 1, z: 1 },
    };
}

export interface UIRectInit {
    anchorMin?: Vec2;
    anchorMax?: Vec2;
    offsetMin?: Vec2;
    offsetMax?: Vec2;
    size?: Vec2;
    pivot?: Vec2;
}

/**
 * Default rect covers the full parent (stretched anchors). Override with
 * size + pivot for fixed-size elements.
 */
export function buildUIRect(init: UIRectInit = {}): UIRectData {
    return {
        anchorMin: init.anchorMin ?? { x: 0, y: 0 },
        anchorMax: init.anchorMax ?? { x: 1, y: 1 },
        offsetMin: init.offsetMin ?? { x: 0, y: 0 },
        offsetMax: init.offsetMax ?? { x: 0, y: 0 },
        size: init.size ?? { x: 0, y: 0 },
        pivot: init.pivot ?? { x: 0.5, y: 0.5 },
    };
}

export interface UIRendererInit {
    visualType?: UIVisualType;
    texture?: number;
    color?: { r: number; g: number; b: number; a: number };
    uvOffset?: Vec2;
    uvScale?: Vec2;
    sliceBorder?: { x: number; y: number; z: number; w: number };
    material?: number;
    enabled?: boolean;
}

export function buildUIRenderer(init: UIRendererInit = {}): UIRendererData {
    return {
        visualType: init.visualType ?? UIVisualType.SolidColor,
        texture: init.texture ?? 0,
        color: init.color ?? { r: 1, g: 1, b: 1, a: 1 },
        uvOffset: init.uvOffset ?? { x: 0, y: 0 },
        uvScale: init.uvScale ?? { x: 1, y: 1 },
        sliceBorder: init.sliceBorder ?? { x: 0, y: 0, z: 0, w: 0 },
        material: init.material ?? 0,
        enabled: init.enabled ?? true,
    };
}

export interface TextInit extends Partial<TextData> {}

export function buildText(init: TextInit = {}): TextData {
    return {
        content: init.content ?? '',
        fontFamily: init.fontFamily ?? 'Arial',
        fontSize: init.fontSize ?? 14,
        color: init.color ?? { r: 1, g: 1, b: 1, a: 1 },
        align: init.align ?? TextAlign.Center,
        verticalAlign: init.verticalAlign ?? TextVerticalAlign.Middle,
        wordWrap: init.wordWrap ?? false,
        overflow: init.overflow ?? 0,
        lineHeight: init.lineHeight ?? 1.2,
        bold: init.bold ?? false,
        italic: init.italic ?? false,
        strokeColor: init.strokeColor ?? { r: 0, g: 0, b: 0, a: 1 },
        strokeWidth: init.strokeWidth ?? 0,
        shadowColor: init.shadowColor ?? { r: 0, g: 0, b: 0, a: 1 },
        shadowBlur: init.shadowBlur ?? 0,
        shadowOffsetX: init.shadowOffsetX ?? 0,
        shadowOffsetY: init.shadowOffsetY ?? 0,
        richText: init.richText ?? false,
    };
}

export interface UIEntityInit {
    world: World;
    parent?: Entity;
    rect?: UIRectInit;
    renderer?: UIRendererInit;
    text?: TextInit;
}

/**
 * Spawn a UI entity with Transform + UIRect, optionally UIRenderer and
 * Text, optionally parented. Returns the entity.
 *
 * Widgets compose with this to avoid repeating the same insert dance.
 */
export function spawnUIEntity(init: UIEntityInit): Entity {
    const { world } = init;
    const entity = world.spawn();

    world.insert(entity, Transform, identityTransform());
    world.insert(entity, UIRect, buildUIRect(init.rect));

    if (init.renderer) {
        world.insert(entity, UIRenderer, buildUIRenderer(init.renderer));
    }
    if (init.text) {
        world.insert(entity, Text, buildText(init.text));
    }
    if (init.parent !== undefined) {
        world.setParent(entity, init.parent);
    }

    return entity;
}

/**
 * Toggle visibility of a UI entity via UIRenderer.enabled. Safe if the
 * entity has no UIRenderer — no-op in that case.
 */
export function setUIVisible(world: World, entity: Entity, visible: boolean): void {
    if (!world.valid(entity) || !world.has(entity, UIRenderer)) return;
    const r = world.get(entity, UIRenderer) as UIRendererData;
    if (r.enabled !== visible) {
        r.enabled = visible;
        world.insert(entity, UIRenderer, r);
    }
}
