// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    placement.ts
 * @brief   What moving a UI node by hand means: the one answer an editor's
 *          viewport, its inspect-while-playing overlay and a game share.
 *
 * @details A UI node's place is the layout's output, so a drag cannot write its
 *          Transform: the next layout pass puts it back. What a drag can change
 *          is the input the layout reads, and which input depends on how the node
 *          is placed:
 *
 *          - Absolute: its insets (and the margins that would fight them) move by
 *            the drag, each side in its own unit, as {@link uiAbsoluteMove} says.
 *          - Flow (Relative): the flow owns its position, so a drag picks its slot
 *            among the siblings it flows with, as an auto
 *            layout reorders a child dragged within its box. {@link uiFlowSlot}.
 *
 *          The two pure functions take boxes and fields and return a slot or a
 *          patch, so the editor's document and a running world apply the same
 *          answer to their own data. {@link moveUINodeBy} and
 *          {@link moveUINodeToward} apply it to a live world.
 *
 *          Boxes are in the frame `uiNodeWorldBox` answers in: y up, one unit per
 *          layout pixel, centre and half extents.
 */
import type { Entity } from '../../types';
import { Parent, Children } from '../../ecs/component';
import { uiNodeWorldBox } from '../../ecs/entityBox';
import type { World } from '../../ecs/world';
import { DimensionUnit, type Dimension } from './dimension';
import { UINode, UIPositionType, UIDisplay, type UINodeData } from './ui-node';
import { FlexContainer, FlexDirection } from '../layout/flex';

/**
 * A box as the layout drew it: centre and half extents, y up.
 *
 * @experimental
 */
export interface UIRect {
    cx: number;
    cy: number;
    hw: number;
    hh: number;
}

/**
 * The fields a hand move of an Absolute node may write.
 *
 * @experimental
 */
export type UIInsetFields = Pick<UINodeData,
    'insetLeft' | 'insetTop' | 'insetRight' | 'insetBottom' |
    'marginLeft' | 'marginTop' | 'marginRight' | 'marginBottom'>;

/**
 * How a node's position is decided: by its insets, by the flow it is in, or not by a hand at all.
 *
 * @experimental
 */
export type UIPlacement = 'absolute' | 'flow';

/**
 * The field patch that moves an Absolute node by (`dx`, `dy`) layout pixels, y up.
 *
 * Each set side moves in its own unit (a right anchor stays a right anchor); an
 * all-`auto` axis is pinned at its near edge. An `auto` margin holds a centre
 * anchor against the move, so a moving axis sets it to 0.
 *
 * @experimental
 */
export function uiAbsoluteMove(node: UIInsetFields, box: UIRect, parent: UIRect, dx: number, dy: number): Partial<UIInsetFields> {
    const patch: Partial<UIInsetFields> = {};
    shiftAxis(patch, node, 'insetLeft', 'insetRight', 'marginLeft', 'marginRight', dx, 2 * parent.hw,
        (box.cx - box.hw) - (parent.cx - parent.hw));
    // Layout is y down: moving up shortens the top inset.
    shiftAxis(patch, node, 'insetTop', 'insetBottom', 'marginTop', 'marginBottom', -dy, 2 * parent.hh,
        (parent.cy + parent.hh) - (box.cy + box.hh));
    return patch;
}

function shiftAxis(
    patch: Partial<UIInsetFields>, node: UIInsetFields,
    nearKey: keyof UIInsetFields, farKey: keyof UIInsetFields,
    marginNear: keyof UIInsetFields, marginFar: keyof UIInsetFields,
    delta: number, parentSize: number, nearPx: number,
): void {
    if (delta === 0) return;
    for (const key of [marginNear, marginFar]) {
        if (node[key].unit === DimensionUnit.Auto) patch[key] = { value: 0, unit: DimensionUnit.Px };
    }
    const moved = (d: Dimension, by: number): Dimension | null => {
        if (d.unit === DimensionUnit.Px) return { value: d.value + by, unit: d.unit };
        if (d.unit === DimensionUnit.Percent && parentSize > 0) return { value: d.value + (by / parentSize) * 100, unit: d.unit };
        return null;
    };
    const near = moved(node[nearKey], delta);
    const far = moved(node[farKey], -delta);
    if (near) patch[nearKey] = near;
    if (far) patch[farKey] = far;
    if (!near && !far) patch[nearKey] = { value: nearPx + delta, unit: DimensionUnit.Px };
}

/**
 * The index a node dragged to `point` takes among `siblings` (its fellow flow
 * children in child order, itself left out). Read in the container's direction,
 * a sibling on an earlier line, or earlier on the same one, comes first.
 *
 * @experimental
 */
export function uiFlowSlot(direction: number, siblings: readonly UIRect[], point: { x: number; y: number }): number {
    const column = direction === FlexDirection.Column || direction === FlexDirection.ColumnReverse;
    const reversed = direction === FlexDirection.RowReverse || direction === FlexDirection.ColumnReverse;
    // Reading coordinates, both growing the way the flow does: along a row x (y is
    // up, so a column runs down -y), across it the way a wrapped line steps (rows
    // wrap downward, columns rightward).
    const main = (x: number, y: number): number => (column ? -y : x) * (reversed ? -1 : 1);
    const cross = (x: number, y: number): number => (column ? x : -y);
    const pm = main(point.x, point.y), pc = cross(point.x, point.y);
    let slot = 0;
    for (const s of siblings) {
        const sc = cross(s.cx, s.cy), half = column ? s.hw : s.hh;
        if (sc + half < pc) { slot++; continue; }   // on an earlier line
        if (sc - half > pc) continue;               // on a later line
        if (main(s.cx, s.cy) < pm) slot++;          // earlier on the point's line
    }
    return slot;
}

/**
 * How `entity`'s position is decided, or null when it is not a UI node a hand can place (no layout parent, or hidden).
 *
 * @experimental
 */
export function uiPlacementOf(world: World, entity: Entity): UIPlacement | null {
    if (!world.valid(entity) || !world.has(entity, UINode)) return null;
    const node = world.get(entity, UINode) as UINodeData;
    if (node.display === UIDisplay.None) return null;
    const parent = parentOf(world, entity);
    if (parent === null || !world.has(parent, UINode)) return null;
    return node.position === UIPositionType.Absolute ? 'absolute' : 'flow';
}

/**
 * Move an Absolute node by (`dx`, `dy`) layout pixels in a live world.
 * @returns the fields written, or null when the node is not Absolute or has no laid-out box yet
 *
 * @experimental
 */
export function moveUINodeBy(world: World, entity: Entity, dx: number, dy: number): Partial<UIInsetFields> | null {
    if (uiPlacementOf(world, entity) !== 'absolute') return null;
    const parent = parentOf(world, entity)!;
    const box = uiNodeWorldBox(world, entity);
    const parentBox = uiNodeWorldBox(world, parent);
    if (!box || !parentBox) return null;
    const node = world.get(entity, UINode) as UINodeData;
    const patch = uiAbsoluteMove(node, box, parentBox, dx, dy);
    if (Object.keys(patch).length > 0) world.set(entity, UINode, { ...node, ...patch });
    return patch;
}

/**
 * Move a flow node to the slot among its siblings that `point` (layout frame, y
 * up) falls in, in a live world. The order is the world's own sibling order, so
 * the layout, hit testing and drawing follow it alike.
 * @returns whether the order changed
 *
 * @experimental
 */
export function moveUINodeToward(world: World, entity: Entity, point: { x: number; y: number }): boolean {
    if (uiPlacementOf(world, entity) !== 'flow') return false;
    const parent = parentOf(world, entity)!;
    const children = (world.tryGet(parent, Children) as { entities?: Entity[] } | null)?.entities ?? [];
    const flow: { id: Entity; box: UIRect }[] = [];
    for (const id of children) {
        if (id === entity || uiPlacementOf(world, id) !== 'flow') continue;
        const box = uiNodeWorldBox(world, id);
        if (box) flow.push({ id, box });
    }
    const direction = world.has(parent, FlexContainer)
        ? (world.get(parent, FlexContainer) as { direction: number }).direction
        : FlexDirection.Column;
    const slot = uiFlowSlot(direction, flow.map((f) => f.box), point);
    const now = flow.filter((f) => children.indexOf(f.id) < children.indexOf(entity)).length;
    if (slot === now) return false;

    // The world's order decides a parent's child order; the node goes beside the sibling it lands next to.
    const order = world.getAllEntities().filter((id) => id !== entity);
    const anchor = slot < flow.length ? flow[slot].id : flow[flow.length - 1]?.id;
    if (anchor === undefined) return false;
    const at = order.indexOf(anchor);
    order.splice(slot < flow.length ? at : at + 1, 0, entity);
    world.applyEntityOrder(order);
    return true;
}

function parentOf(world: World, entity: Entity): Entity | null {
    const p = world.tryGet(entity, Parent) as { entity?: Entity } | null;
    return p?.entity !== undefined && world.valid(p.entity) ? p.entity : null;
}
