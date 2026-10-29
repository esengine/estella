// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/layout.ts
 * @brief   `Layout`: a container that arranges its children in a row, a column or a grid.
 *
 * The arithmetic is Cocos's, ported rather than re-derived, so a list lands where it landed there: positions come from the layout's
 * anchor and padding, each child contributes its size (times its scale only if `affectedByScale`), and a row or column breaks when
 * the next child would cross the far edge, or at a fixed count. `resizeMode` lets the container grow to fit (CONTAINER) or the
 * children stretch to fill it (CHILDREN).
 *
 * Cocos relayouts when something it listens to changes. Here the pass compares what the layout depends on — its settings and the
 * active children with their sizes — against what it saw last, and relayouts on a difference, which is the same trigger without a
 * listener on every child. `updateLayout()` forces it now.
 */
import { Component } from '../component';
import { Node } from '../node';
import { Size, Vec3 } from '../math';
import { declareClass } from '../host';
import { instancesOfClass } from '../registry';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { UITransform } from './uiTransform';
import { depthOf } from './widget';

const Type = Object.freeze({ NONE: 0, HORIZONTAL: 1, VERTICAL: 2, GRID: 3 });
const ResizeMode = Object.freeze({ NONE: 0, CONTAINER: 1, CHILDREN: 2 });
const AxisDirection = Object.freeze({ HORIZONTAL: 0, VERTICAL: 1 });
const VerticalDirection = Object.freeze({ BOTTOM_TO_TOP: 0, TOP_TO_BOTTOM: 1 });
const HorizontalDirection = Object.freeze({ LEFT_TO_RIGHT: 0, RIGHT_TO_LEFT: 1 });
const Constraint = Object.freeze({ NONE: 0, FIXED_ROW: 1, FIXED_COL: 2 });

const SETTINGS = [
    'type', 'resizeMode', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'spacingX', 'spacingY',
    'verticalDirection', 'horizontalDirection', 'affectedByScale', 'cellWidth', 'cellHeight', 'startAxis', 'constraint', 'constraintNum', 'isAlign',
] as const;

export class Layout extends Component {
    static readonly Type = Type;
    static readonly ResizeMode = ResizeMode;
    static readonly AxisDirection = AxisDirection;
    static readonly VerticalDirection = VerticalDirection;
    static readonly HorizontalDirection = HorizontalDirection;
    static readonly Constraint = Constraint;

    type: number = Type.NONE;
    resizeMode: number = ResizeMode.NONE;
    paddingLeft = 0;
    paddingRight = 0;
    paddingTop = 0;
    paddingBottom = 0;
    spacingX = 0;
    spacingY = 0;
    verticalDirection: number = VerticalDirection.TOP_TO_BOTTOM;
    horizontalDirection: number = HorizontalDirection.LEFT_TO_RIGHT;
    affectedByScale = false;
    cellWidth = 40;
    cellHeight = 40;
    startAxis: number = AxisDirection.HORIZONTAL;
    constraint: number = Constraint.NONE;
    constraintNum = 2;
    isAlign = false;

    /** @internal */
    _seen = '';

    get cellSize(): Size { return new Size(this.cellWidth, this.cellHeight); }
    set cellSize(v: Size) { this.cellWidth = v.width; this.cellHeight = v.height; }
    get alignHorizontal(): boolean { return this.isAlign; }
    set alignHorizontal(v: boolean) { this.isAlign = v; }
    get alignVertical(): boolean { return this.isAlign; }
    set alignVertical(v: boolean) { this.isAlign = v; }
    get padding(): number { return this.paddingLeft; }
    set padding(v: number) { this.paddingLeft = this.paddingRight = this.paddingTop = this.paddingBottom = v; }

    /** Arrange the children now, rather than at the end of the frame. */
    updateLayout(force = false): void {
        if (force) this._seen = '';
        layoutNode(this);
        this._seen = this.signature_();
    }

    /** @internal What the layout depends on: its settings, and the useful children with their sizes. */
    signature_(): string {
        let s = '';
        for (const k of SETTINGS) s += `${this[k]},`;
        const own = this.node.getComponent(UITransform);
        if (own) s += `${own.width},${own.height},${own.anchorX},${own.anchorY}`;
        const scaled = this.affectedByScale;
        for (const t of usefulChildren(this)) {
            const sc = scaled ? t.node.getScale() : null;
            s += `|${t.node._entity},${t.width},${t.height}${sc ? `,${sc.x},${sc.y}` : ''}`;
        }
        return s;
    }
}

/** Active children that have a rectangle, in sibling order. */
function usefulChildren(layout: Layout): UITransform[] {
    const out: UITransform[] = [];
    for (const child of layout.node.children) {
        if (!child.active) continue;
        const t = child.getComponent(UITransform);
        if (t) out.push(t);
    }
    return out;
}

const used = (layout: Layout, scale: number): number => (layout.affectedByScale ? Math.abs(scale) : 1);
const paddingH = (l: Layout): number => l.paddingLeft + l.paddingRight;
const paddingV = (l: Layout): number => l.paddingTop + l.paddingBottom;

/** How many children a row (or column) holds under a fixed constraint, 0 when it is free. */
function fixedBreakingNum(l: Layout, count: number): number {
    if (l.type !== Type.GRID || l.constraint === Constraint.NONE || l.constraintNum <= 0) return 0;
    let num = l.constraint === Constraint.FIXED_ROW ? Math.ceil(count / l.constraintNum) : l.constraintNum;
    if (l.startAxis === AxisDirection.VERTICAL) num = l.constraint === Constraint.FIXED_COL ? Math.ceil(count / l.constraintNum) : l.constraintNum;
    return num;
}

type Position = (child: Node, t: UITransform, offset: number) => number;

function layoutHorizontally(l: Layout, children: UITransform[], self: UITransform, baseWidth: number, rowBreak: boolean, positionY: Position, apply: boolean): number {
    const limit = fixedBreakingNum(l, children.length);
    let sign = 1;
    let padX = l.paddingLeft;
    if (l.horizontalDirection === HorizontalDirection.RIGHT_TO_LEFT) { sign = -1; padX = l.paddingRight; }

    const startPos = (l.horizontalDirection - self.anchorX) * baseWidth + sign * padX;
    let nextX = startPos - sign * l.spacingX;
    let totalHeight = 0, rowMaxHeight = 0, tempMaxHeight = 0, maxHeight = 0;
    let isBreak = false;
    let newChildWidth = l.cellWidth;
    if (l.type !== Type.GRID && l.resizeMode === ResizeMode.CHILDREN) {
        newChildWidth = (baseWidth - paddingH(l) - (children.length - 1) * l.spacingX) / children.length;
    }

    for (let i = 0; i < children.length; i++) {
        const t = children[i]!;
        const child = t.node;
        const scale = child.getScale();
        const sx = used(l, scale.x), sy = used(l, scale.y);
        if (l.resizeMode === ResizeMode.CHILDREN) {
            t.width = newChildWidth / sx;
            if (l.type === Type.GRID) t.height = l.cellHeight / sy;
        }
        const anchorX = Math.abs(l.horizontalDirection - t.anchorX);
        const w = t.width * sx;
        const h = t.height * sy;

        if (h > tempMaxHeight) {
            maxHeight = Math.max(tempMaxHeight, maxHeight);
            rowMaxHeight = tempMaxHeight || h;
            tempMaxHeight = h;
        }
        nextX += sign * (anchorX * w + l.spacingX);
        const rightBoundary = sign * (1 - anchorX) * w;

        if (rowBreak) {
            if (limit > 0) {
                isBreak = i / limit > 0 && i % limit === 0;
                if (isBreak) rowMaxHeight = tempMaxHeight > h ? tempMaxHeight : rowMaxHeight;
            } else if (w > baseWidth - paddingH(l)) {
                if (nextX > startPos + sign * (anchorX * w)) isBreak = true;
            } else {
                const boundary = (1 - l.horizontalDirection - self.anchorX) * baseWidth;
                const breakBoundary = nextX + rightBoundary + sign * (sign > 0 ? l.paddingRight : l.paddingLeft);
                isBreak = Math.abs(breakBoundary) > Math.abs(boundary);
            }
            if (isBreak) {
                nextX = startPos + sign * (anchorX * w);
                if (h !== tempMaxHeight) rowMaxHeight = tempMaxHeight;
                totalHeight += rowMaxHeight + l.spacingY;
                rowMaxHeight = tempMaxHeight = h;
            }
        }
        const y = positionY(child, t, totalHeight);
        if (apply) child.setPosition(nextX, y);
        nextX += rightBoundary;
    }
    rowMaxHeight = Math.max(rowMaxHeight, tempMaxHeight);
    return Math.max(maxHeight, totalHeight + rowMaxHeight) + paddingV(l);
}

function layoutVertically(l: Layout, children: UITransform[], self: UITransform, baseHeight: number, columnBreak: boolean, positionX: Position, apply: boolean): number {
    const limit = fixedBreakingNum(l, children.length);
    let sign = 1;
    let padY = l.paddingBottom;
    if (l.verticalDirection === VerticalDirection.TOP_TO_BOTTOM) { sign = -1; padY = l.paddingTop; }

    const startPos = (l.verticalDirection - self.anchorY) * baseHeight + sign * padY;
    let nextY = startPos - sign * l.spacingY;
    let tempMaxWidth = 0, maxWidth = 0, colMaxWidth = 0, totalWidth = 0;
    let isBreak = false;
    let newChildHeight = l.cellHeight;
    if (l.type !== Type.GRID && l.resizeMode === ResizeMode.CHILDREN) {
        newChildHeight = (baseHeight - paddingV(l) - (children.length - 1) * l.spacingY) / children.length;
    }

    for (let i = 0; i < children.length; i++) {
        const t = children[i]!;
        const child = t.node;
        const scale = child.getScale();
        const sx = used(l, scale.x), sy = used(l, scale.y);
        if (l.resizeMode === ResizeMode.CHILDREN) {
            t.height = newChildHeight / sy;
            if (l.type === Type.GRID) t.width = l.cellWidth / sx;
        }
        const anchorY = Math.abs(l.verticalDirection - t.anchorY);
        const w = t.width * sx;
        const h = t.height * sy;

        if (w > tempMaxWidth) {
            maxWidth = Math.max(tempMaxWidth, maxWidth);
            colMaxWidth = tempMaxWidth || w;
            tempMaxWidth = w;
        }
        nextY += sign * (anchorY * h + l.spacingY);
        const topBoundary = sign * (1 - anchorY) * h;

        if (columnBreak) {
            if (limit > 0) {
                isBreak = i / limit > 0 && i % limit === 0;
                if (isBreak) colMaxWidth = tempMaxWidth > h ? tempMaxWidth : colMaxWidth;
            } else if (h > baseHeight - paddingV(l)) {
                if (nextY > startPos + sign * (anchorY * h)) isBreak = true;
            } else {
                const boundary = (1 - l.verticalDirection - self.anchorY) * baseHeight;
                const breakBoundary = nextY + topBoundary + sign * (sign > 0 ? l.paddingTop : l.paddingBottom);
                isBreak = Math.abs(breakBoundary) > Math.abs(boundary);
            }
            if (isBreak) {
                nextY = startPos + sign * (anchorY * h);
                if (w !== tempMaxWidth) colMaxWidth = tempMaxWidth;
                totalWidth += colMaxWidth + l.spacingX;
                colMaxWidth = tempMaxWidth = w;
            }
        }
        const x = positionX(child, t, totalWidth);
        if (apply) child.setPosition(new Vec3(x, nextY, child.getPosition().z));
        nextY += topBoundary;
    }
    colMaxWidth = Math.max(colMaxWidth, tempMaxWidth);
    return Math.max(maxWidth, totalWidth + colMaxWidth) + paddingH(l);
}

/** Arrange one layout's children. */
export function layoutNode(l: Layout): void {
    const self = l.node.getComponent(UITransform);
    if (!self) return;
    const children = usefulChildren(l);

    if (l.type === Type.HORIZONTAL) {
        let baseWidth = self.width;
        if (l.resizeMode === ResizeMode.CONTAINER) {
            baseWidth = children.reduce((s, t) => s + t.width * used(l, t.node.getScale().x), 0) + (children.length - 1) * l.spacingX + paddingH(l);
        }
        layoutHorizontally(l, children, self, baseWidth, false, (c) => (l.isAlign ? 0 : c.getPosition().y), true);
        self.width = baseWidth;
    } else if (l.type === Type.VERTICAL) {
        let baseHeight = self.height;
        if (l.resizeMode === ResizeMode.CONTAINER) {
            baseHeight = children.reduce((s, t) => s + t.height * used(l, t.node.getScale().y), 0) + (children.length - 1) * l.spacingY + paddingV(l);
        }
        layoutVertically(l, children, self, baseHeight, false, (c) => (l.isAlign ? 0 : c.getPosition().x), true);
        self.height = baseHeight;
    } else if (l.type === Type.GRID) {
        const anchor = { x: self.anchorX, y: self.anchorY };
        const size = { width: self.width, height: self.height };
        if (l.startAxis === AxisDirection.HORIZONTAL) {
            let sign = 1;
            let bottom = -anchor.y * size.height;
            let padY = l.paddingBottom;
            if (l.verticalDirection === VerticalDirection.TOP_TO_BOTTOM) { sign = -1; bottom = (1 - anchor.y) * size.height; padY = l.paddingTop; }
            const fn: Position = (c, t, off) => bottom + sign * (off + (1 - t.anchorY) * t.height * used(l, c.getScale().y) + padY);
            let newHeight = 0;
            if (l.resizeMode === ResizeMode.CONTAINER) {
                newHeight = layoutHorizontally(l, children, self, size.width, true, fn, false);
                bottom = -anchor.y * newHeight;
                if (l.verticalDirection === VerticalDirection.TOP_TO_BOTTOM) bottom = (1 - anchor.y) * newHeight;
            }
            layoutHorizontally(l, children, self, size.width, true, fn, true);
            if (l.resizeMode === ResizeMode.CONTAINER) self.setContentSize(size.width, newHeight);
        } else {
            let sign = 1;
            let left = -anchor.x * size.width;
            let padX = l.paddingLeft;
            if (l.horizontalDirection === HorizontalDirection.RIGHT_TO_LEFT) { sign = -1; left = (1 - anchor.x) * size.width; padX = l.paddingRight; }
            const fn: Position = (c, t, off) => left + sign * (off + (1 - t.anchorX) * t.width * used(l, c.getScale().x) + padX);
            let newWidth = 0;
            if (l.resizeMode === ResizeMode.CONTAINER) {
                newWidth = layoutVertically(l, children, self, size.height, true, fn, false);
                left = -anchor.x * newWidth;
                if (l.horizontalDirection === HorizontalDirection.RIGHT_TO_LEFT) left = (1 - anchor.x) * newWidth;
            }
            layoutVertically(l, children, self, size.height, true, fn, true);
            if (l.resizeMode === ResizeMode.CONTAINER) self.setContentSize(newWidth, size.height);
        }
    }
}

/** Arrange every layout whose inputs changed, innermost first (an outer container may be sized by an inner one). */
export function layoutAll(world: World): void {
    const due: Array<{ layout: Layout; depth: number }> = [];
    for (const [entity, inst] of instancesOfClass(world, Layout) as Array<[Entity, Layout]>) {
        if (!inst.enabled || !world.isEntityActive(entity) || inst.type === Type.NONE) continue;
        const sig = inst.signature_();
        if (sig === inst._seen) continue;
        due.push({ layout: inst, depth: depthOf(inst.node) });
    }
    due.sort((a, b) => b.depth - a.depth);
    for (const { layout } of due) {
        layoutNode(layout);
        // Laying out can resize the container or the children, which changes what the layout depends on; record the result so it settles.
        layout._seen = layout.signature_();
    }
}

export function declareLayout(): void {
    declareClass(Layout as never, 'Layout', [
        ...['type', 'resizeMode', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'spacingX', 'spacingY',
            'verticalDirection', 'horizontalDirection', 'cellWidth', 'cellHeight', 'startAxis', 'constraint', 'constraintNum']
            .map((name) => ({ name, kind: 'number' as const })),
        { name: 'affectedByScale', kind: 'boolean' as const },
        { name: 'isAlign', kind: 'boolean' as const },
    ]);
}
