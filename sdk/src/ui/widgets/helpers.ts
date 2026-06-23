// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {
    Transform,
    type TransformData,
} from '../../component';
import type { Entity, Vec2 } from '../../types';
import type { World } from '../../world';

import { UINode, UIPositionType, type UINodeData } from '../core/ui-node';
import { px, percent, auto, type Dimension } from '../core/dimension';
import { UIVisual, UIVisualType, FillMethod, FillOrigin, type UIVisualData } from '../core/ui-visual';
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

export interface UINodeInit {
    /** Stretch to fill the parent (absolute + inset 0 on all edges). */
    fill?: boolean;
    /** UIPositionType: Relative (flex flow) or Absolute (placed by inset). */
    position?: number;
    width?: Dimension;
    height?: Dimension;
    insetLeft?: Dimension;
    insetTop?: Dimension;
    insetRight?: Dimension;
    insetBottom?: Dimension;
    flexGrow?: number;
    flexShrink?: number;
    marginLeft?: Dimension;
    marginTop?: Dimension;
    marginRight?: Dimension;
    marginBottom?: Dimension;
}

/**
 * Build a UINode (CSS box). `fill: true` is the common widget case
 * (stretch to the parent); otherwise set width/height and/or inset. Anchoring
 * (e.g. top-right) = position Absolute + the relevant insets.
 */
export function buildUINode(init: UINodeInit = {}): UINodeData {
    const fill = init.fill ?? false;
    return {
        position: init.position ?? (fill ? UIPositionType.Absolute : UIPositionType.Relative),
        width: init.width ?? auto(),
        height: init.height ?? auto(),
        minWidth: auto(),
        minHeight: auto(),
        maxWidth: auto(),
        maxHeight: auto(),
        flexGrow: init.flexGrow ?? 0,
        flexShrink: init.flexShrink ?? 1,
        flexBasis: auto(),
        alignSelf: 0,
        marginLeft: init.marginLeft ?? px(0),
        marginTop: init.marginTop ?? px(0),
        marginRight: init.marginRight ?? px(0),
        marginBottom: init.marginBottom ?? px(0),
        insetLeft: init.insetLeft ?? (fill ? px(0) : auto()),
        insetTop: init.insetTop ?? (fill ? px(0) : auto()),
        insetRight: init.insetRight ?? (fill ? px(0) : auto()),
        insetBottom: init.insetBottom ?? (fill ? px(0) : auto()),
    };
}

export interface UIVisualInit {
    visualType?: UIVisualType;
    texture?: number;
    color?: { r: number; g: number; b: number; a: number };
    uvOffset?: Vec2;
    uvScale?: Vec2;
    sliceBorder?: { x: number; y: number; z: number; w: number };
    tileSize?: Vec2;
    fillMethod?: FillMethod;
    fillOrigin?: FillOrigin;
    fillAmount?: number;
    material?: number;
    enabled?: boolean;
}

export function buildUIVisual(init: UIVisualInit = {}): UIVisualData {
    return {
        visualType: init.visualType ?? UIVisualType.SolidColor,
        texture: init.texture ?? 0,
        color: init.color ?? { r: 1, g: 1, b: 1, a: 1 },
        uvOffset: init.uvOffset ?? { x: 0, y: 0 },
        uvScale: init.uvScale ?? { x: 1, y: 1 },
        sliceBorder: init.sliceBorder ?? { x: 0, y: 0, z: 0, w: 0 },
        tileSize: init.tileSize ?? { x: 32, y: 32 },
        fillMethod: init.fillMethod ?? FillMethod.Horizontal,
        fillOrigin: init.fillOrigin ?? FillOrigin.Left,
        fillAmount: init.fillAmount ?? 1,
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
    /** CSS-box layout (defaults to fill the parent). */
    node?: UINodeInit;
    visual?: UIVisualInit;
    text?: TextInit;
}

/**
 * Spawn a UI entity with Transform + UINode, optionally UIVisual and
 * Text, optionally parented. Returns the entity.
 *
 * Widgets compose with this to avoid repeating the same insert dance.
 */
export function spawnUIEntity(init: UIEntityInit): Entity {
    const { world } = init;
    const entity = world.spawn();

    world.insert(entity, Transform, identityTransform());
    world.insert(entity, UINode, buildUINode(init.node));

    if (init.visual) {
        world.insert(entity, UIVisual, buildUIVisual(init.visual));
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
 * Toggle visibility of a UI entity via UIVisual.enabled. Safe if the
 * entity has no UIVisual — no-op in that case.
 */
export function setUIVisible(world: World, entity: Entity, visible: boolean): void {
    if (!world.valid(entity) || !world.has(entity, UIVisual)) return;
    const r = world.get(entity, UIVisual) as UIVisualData;
    if (r.enabled !== visible) {
        r.enabled = visible;
        world.insert(entity, UIVisual, r);
    }
}
