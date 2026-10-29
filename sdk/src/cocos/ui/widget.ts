// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/widget.ts
 * @brief   `Widget`: a node pinned to the edges (or centre) of its parent's rectangle.
 *
 * The arithmetic is Cocos's own, so a panel lands where it landed there: each axis is either stretched (both edges set — the size
 * follows the parent), pinned to one edge, or centred with an offset, with margins in pixels or as a fraction of the parent. A node
 * whose parent has no rectangle aligns to the visible area (see screen.ts).
 *
 * When it runs follows `alignMode`: ONCE the first time, ON_WINDOW_RESIZE on enable and whenever the visible size changes, ALWAYS
 * every frame. Changing any of the widget's own settings re-aligns it whatever the mode, which is what the setters do in Cocos.
 *
 * Only the parent as target is supported; a widget that names another node as its target aligns to the parent and says so once.
 */
import { Component } from '../component';
import { Node } from '../node';
import { Vec3 } from '../math';
import { declareClass } from '../host';
import { instancesOfClass } from '../registry';
import { log } from '../../util/logger';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { UITransform } from './uiTransform';
import { getVisibleSize, visibleSizeGeneration } from './screen';

const AlignFlags = Object.freeze({ TOP: 1, MID: 2, BOT: 4, LEFT: 8, CENTER: 16, RIGHT: 32, HORIZONTAL: 8 | 16 | 32, VERTICAL: 1 | 2 | 4 });
const AlignMode = Object.freeze({ ONCE: 0, ON_WINDOW_RESIZE: 1, ALWAYS: 2 });

const SETTINGS = [
    'alignFlags', 'left', 'right', 'top', 'bottom', 'horizontalCenter', 'verticalCenter',
    'isAbsLeft', 'isAbsRight', 'isAbsTop', 'isAbsBottom', 'isAbsHorizontalCenter', 'isAbsVerticalCenter', 'alignMode',
] as const;

export class Widget extends Component {
    static readonly AlignMode = AlignMode;
    static readonly AlignFlags = AlignFlags;

    alignFlags = 0;
    left = 0;
    right = 0;
    top = 0;
    bottom = 0;
    horizontalCenter = 0;
    verticalCenter = 0;
    isAbsLeft = true;
    isAbsRight = true;
    isAbsTop = true;
    isAbsBottom = true;
    isAbsHorizontalCenter = true;
    isAbsVerticalCenter = true;
    alignMode: number = AlignMode.ON_WINDOW_RESIZE;
    target: Node | null = null;

    /** @internal What the last alignment saw: the settings, and the visible size it was done at. */
    _seen = '';
    _seenGeneration = -1;
    _hadAlignOnce = false;
    _warnedTarget = false;

    private flag_(bit: number): boolean { return (this.alignFlags & bit) > 0; }
    private setFlag_(bit: number, on: boolean, clears = 0): void {
        this.alignFlags = on ? (this.alignFlags | bit) & ~clears : this.alignFlags & ~bit;
    }
    get isAlignLeft(): boolean { return this.flag_(AlignFlags.LEFT); }
    set isAlignLeft(v: boolean) { this.setFlag_(AlignFlags.LEFT, v, AlignFlags.CENTER); }
    get isAlignRight(): boolean { return this.flag_(AlignFlags.RIGHT); }
    set isAlignRight(v: boolean) { this.setFlag_(AlignFlags.RIGHT, v, AlignFlags.CENTER); }
    get isAlignTop(): boolean { return this.flag_(AlignFlags.TOP); }
    set isAlignTop(v: boolean) { this.setFlag_(AlignFlags.TOP, v, AlignFlags.MID); }
    get isAlignBottom(): boolean { return this.flag_(AlignFlags.BOT); }
    set isAlignBottom(v: boolean) { this.setFlag_(AlignFlags.BOT, v, AlignFlags.MID); }
    get isAlignHorizontalCenter(): boolean { return this.flag_(AlignFlags.CENTER); }
    set isAlignHorizontalCenter(v: boolean) { this.setFlag_(AlignFlags.CENTER, v, AlignFlags.LEFT | AlignFlags.RIGHT); }
    get isAlignVerticalCenter(): boolean { return this.flag_(AlignFlags.MID); }
    set isAlignVerticalCenter(v: boolean) { this.setFlag_(AlignFlags.MID, v, AlignFlags.TOP | AlignFlags.BOT); }
    get isStretchWidth(): boolean { return (this.alignFlags & (AlignFlags.LEFT | AlignFlags.RIGHT)) === (AlignFlags.LEFT | AlignFlags.RIGHT); }
    get isStretchHeight(): boolean { return (this.alignFlags & (AlignFlags.TOP | AlignFlags.BOT)) === (AlignFlags.TOP | AlignFlags.BOT); }

    get isAbsoluteLeft(): boolean { return this.isAbsLeft; }
    set isAbsoluteLeft(v: boolean) { this.isAbsLeft = v; }
    get isAbsoluteRight(): boolean { return this.isAbsRight; }
    set isAbsoluteRight(v: boolean) { this.isAbsRight = v; }
    get isAbsoluteTop(): boolean { return this.isAbsTop; }
    set isAbsoluteTop(v: boolean) { this.isAbsTop = v; }
    get isAbsoluteBottom(): boolean { return this.isAbsBottom; }
    set isAbsoluteBottom(v: boolean) { this.isAbsBottom = v; }
    get isAbsoluteHorizontalCenter(): boolean { return this.isAbsHorizontalCenter; }
    set isAbsoluteHorizontalCenter(v: boolean) { this.isAbsHorizontalCenter = v; }
    get isAbsoluteVerticalCenter(): boolean { return this.isAbsVerticalCenter; }
    set isAbsoluteVerticalCenter(v: boolean) { this.isAbsVerticalCenter = v; }

    /** Align now, rather than at the end of the frame. */
    updateAlignment(): void {
        this._hadAlignOnce = false;
        alignWidget(this);
    }

    /** Ask for alignment at the end of the frame, whatever the mode. */
    setDirty(): void { this._seen = ''; this._hadAlignOnce = false; }

    private signature_(): string {
        let s = '';
        for (const k of SETTINGS) s += `${this[k]},`;
        return s;
    }

    /** @internal Whether the pass should align this widget now. */
    _due(generation: number): boolean {
        if (this.alignFlags === 0) return false;
        if (this.alignMode === AlignMode.ALWAYS) return true;
        const sig = this.signature_();
        if (sig !== this._seen) { this._seen = sig; this._seenGeneration = generation; this._hadAlignOnce = false; return true; }
        if (this.alignMode === AlignMode.ONCE) return false;
        if (generation !== this._seenGeneration) { this._seenGeneration = generation; return true; }
        return false;
    }
}

interface Anchor { x: number; y: number }

/** Align one widget to its parent, as Cocos's `align` does (rotation ignored). */
export function alignWidget(widget: Widget): void {
    if (widget._hadAlignOnce) return;
    if (widget.alignMode === AlignMode.ONCE) widget._hadAlignOnce = true;
    const node = widget.node;
    const own = node.getComponent(UITransform);
    if (!own) return;
    if (widget.target && widget.target !== node.parent && !widget._warnedTarget) {
        widget._warnedTarget = true;
        log.warn('cocos', `${node.name}: Widget.target other than the parent is not supported; aligning to the parent`);
    }

    const parent = node.parent;
    const parentTransform = parent?.getComponent(UITransform) ?? null;
    const isRoot = !parentTransform;
    const visible = getVisibleSize();
    const targetW = parentTransform ? parentTransform.width : visible.width;
    const targetH = parentTransform ? parentTransform.height : visible.height;
    const targetAnchor: Anchor = parentTransform ? { x: parentTransform.anchorX, y: parentTransform.anchorY } : { x: 0, y: 0 };

    const pos = node.getPosition();
    const scale = node.getScale();
    let x = pos.x;
    let y = pos.y;

    if (widget.alignFlags & AlignFlags.HORIZONTAL) {
        let left = isRoot ? 0 : -targetAnchor.x * targetW;
        let right = isRoot ? visible.width : left + targetW;
        left += widget.isAbsLeft ? widget.left : widget.left * targetW;
        right -= widget.isAbsRight ? widget.right : widget.right * targetW;
        let anchorX = own.anchorX;
        let scaleX = scale.x;
        if (scaleX < 0) { anchorX = 1 - anchorX; scaleX = -scaleX; }
        if (widget.isStretchWidth) {
            const width = right - left;
            if (scaleX !== 0) own.width = width / scaleX;
            x = left + anchorX * width;
        } else {
            const width = own.width * scaleX;
            if (widget.isAlignHorizontalCenter) {
                const offset = widget.isAbsHorizontalCenter ? widget.horizontalCenter : widget.horizontalCenter * targetW;
                const center = (0.5 - targetAnchor.x) * targetW;
                x = center + (anchorX - 0.5) * width + offset;
            } else if (widget.isAlignLeft) {
                x = left + anchorX * width;
            } else {
                x = right + (anchorX - 1) * width;
            }
        }
    }

    if (widget.alignFlags & AlignFlags.VERTICAL) {
        let bottom = isRoot ? 0 : -targetAnchor.y * targetH;
        let top = isRoot ? visible.height : bottom + targetH;
        bottom += widget.isAbsBottom ? widget.bottom : widget.bottom * targetH;
        top -= widget.isAbsTop ? widget.top : widget.top * targetH;
        let anchorY = own.anchorY;
        let scaleY = scale.y;
        if (scaleY < 0) { anchorY = 1 - anchorY; scaleY = -scaleY; }
        if (widget.isStretchHeight) {
            const height = top - bottom;
            if (scaleY !== 0) own.height = height / scaleY;
            y = bottom + anchorY * height;
        } else {
            const height = own.height * scaleY;
            if (widget.isAlignVerticalCenter) {
                const offset = widget.isAbsVerticalCenter ? widget.verticalCenter : widget.verticalCenter * targetH;
                const middle = (0.5 - targetAnchor.y) * targetH;
                y = middle + (anchorY - 0.5) * height + offset;
            } else if (widget.isAlignBottom) {
                y = bottom + anchorY * height;
            } else {
                y = top + (anchorY - 1) * height;
            }
        }
    }
    node.setPosition(new Vec3(x, y, pos.z));
}

/** How deep a node is: parents align before the children that depend on their size. */
export function depthOf(node: Node): number {
    let d = 0;
    for (let p = node.parent; p; p = p.parent) d++;
    return d;
}

/** Align every widget that is due, parents first. */
export function alignAllWidgets(world: World): void {
    const generation = visibleSizeGeneration();
    const due: Array<{ widget: Widget; depth: number }> = [];
    for (const [entity, inst] of instancesOfClass(world, Widget) as Array<[Entity, Widget]>) {
        if (!inst.enabled || !world.isEntityActive(entity)) continue;
        if (inst._due(generation)) due.push({ widget: inst, depth: depthOf(inst.node) });
    }
    due.sort((a, b) => a.depth - b.depth);
    for (const { widget } of due) alignWidget(widget);
}

/** Declare the widget's component, so a scene that holds one finds it. */
export function declareWidget(): void {
    declareClass(Widget as never, 'Widget', [
        ...['alignFlags', 'left', 'right', 'top', 'bottom', 'horizontalCenter', 'verticalCenter', 'alignMode'].map((name) => ({ name, kind: 'number' as const })),
        ...['isAbsLeft', 'isAbsRight', 'isAbsTop', 'isAbsBottom', 'isAbsHorizontalCenter', 'isAbsVerticalCenter'].map((name) => ({ name, kind: 'boolean' as const })),
        { name: 'target', kind: 'node' as const },
    ]);
}
