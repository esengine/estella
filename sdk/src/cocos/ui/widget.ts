// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/widget.ts
 * @brief   `Widget`: a view on the engine's `RectAnchors`.
 *
 * The alignment itself (stretch, pin to an edge, centre, margins in units or as a fraction) is the engine's: `RectAnchors` is a component of
 * its own, aligned by an engine system in the editor's edit mode as well as in play. A Cocos `Widget` is that component under Cocos's names.
 * A node whose parent has no rectangle aligns to the screen, the centred layout box of the UI camera's domain.
 *
 * Only the parent as target is supported; a widget that names another node as its target aligns to the parent and says so once.
 */
import { registerComponent } from '../../ecs/component';
import { RectAnchors, AnchorFlag, AnchorMode, alignRectAnchorsNow, type RectAnchorsData } from '../../ui/layout/rect-anchors';
import { ScreenLayout } from '../../ui/core/screen-layout';
import { Component } from '../component';
import { Node } from '../node';
import { registerBuiltinComponent } from '../builtins';
import { log } from '../../util/logger';
import { getScreenLayoutOf } from './screen';
import { viewAdapter } from './view';

const AlignFlags = Object.freeze({ TOP: AnchorFlag.TOP, MID: AnchorFlag.MID, BOT: AnchorFlag.BOTTOM, LEFT: AnchorFlag.LEFT, CENTER: AnchorFlag.CENTER, RIGHT: AnchorFlag.RIGHT, HORIZONTAL: AnchorFlag.HORIZONTAL, VERTICAL: AnchorFlag.VERTICAL });
const AlignMode = Object.freeze({ ONCE: AnchorMode.ONCE, ON_WINDOW_RESIZE: AnchorMode.ON_RESIZE, ALWAYS: AnchorMode.ALWAYS });

type NumberKey = 'alignFlags' | 'left' | 'right' | 'top' | 'bottom' | 'horizontalCenter' | 'verticalCenter' | 'alignMode';
type FlagKey = 'isAbsLeft' | 'isAbsRight' | 'isAbsTop' | 'isAbsBottom' | 'isAbsHorizontalCenter' | 'isAbsVerticalCenter';

export class Widget extends Component {
    static readonly AlignMode = AlignMode;
    static readonly AlignFlags = AlignFlags;

    /** The node another widget setting names as its target; only the parent is honoured. */
    target: Node | null = null;
    private warnedTarget_ = false;

    private data_(): RectAnchorsData { return this._world.get(this._entity, RectAnchors); }
    private patch_(fields: Partial<RectAnchorsData>): void {
        if (this.target && this.target !== this.node.parent && !this.warnedTarget_) {
            this.warnedTarget_ = true;
            log.warn('cocos', `${this.node.name}: Widget.target other than the parent is not supported; aligning to the parent`);
        }
        this._world.set(this._entity, RectAnchors, { ...this.data_(), ...fields });
    }
    private num_(key: NumberKey): number { return this.data_()[key]; }
    private flag_(key: FlagKey): boolean { return this.data_()[key]; }
    private bit_(bit: number): boolean { return (this.data_().alignFlags & bit) > 0; }
    private setBit_(bit: number, on: boolean, clears = 0): void {
        const flags = this.data_().alignFlags;
        this.patch_({ alignFlags: on ? (flags | bit) & ~clears : flags & ~bit });
    }

    get enabled(): boolean { return this.data_().enabled; }
    set enabled(v: boolean) { this.patch_({ enabled: v }); }

    get alignFlags(): number { return this.num_('alignFlags'); }
    set alignFlags(v: number) { this.patch_({ alignFlags: v }); }
    get alignMode(): number { return this.num_('alignMode'); }
    set alignMode(v: number) { this.patch_({ alignMode: v }); }
    get left(): number { return this.num_('left'); }
    set left(v: number) { this.patch_({ left: v }); }
    get right(): number { return this.num_('right'); }
    set right(v: number) { this.patch_({ right: v }); }
    get top(): number { return this.num_('top'); }
    set top(v: number) { this.patch_({ top: v }); }
    get bottom(): number { return this.num_('bottom'); }
    set bottom(v: number) { this.patch_({ bottom: v }); }
    get horizontalCenter(): number { return this.num_('horizontalCenter'); }
    set horizontalCenter(v: number) { this.patch_({ horizontalCenter: v }); }
    get verticalCenter(): number { return this.num_('verticalCenter'); }
    set verticalCenter(v: number) { this.patch_({ verticalCenter: v }); }

    get isAbsLeft(): boolean { return this.flag_('isAbsLeft'); }
    set isAbsLeft(v: boolean) { this.patch_({ isAbsLeft: v }); }
    get isAbsRight(): boolean { return this.flag_('isAbsRight'); }
    set isAbsRight(v: boolean) { this.patch_({ isAbsRight: v }); }
    get isAbsTop(): boolean { return this.flag_('isAbsTop'); }
    set isAbsTop(v: boolean) { this.patch_({ isAbsTop: v }); }
    get isAbsBottom(): boolean { return this.flag_('isAbsBottom'); }
    set isAbsBottom(v: boolean) { this.patch_({ isAbsBottom: v }); }
    get isAbsHorizontalCenter(): boolean { return this.flag_('isAbsHorizontalCenter'); }
    set isAbsHorizontalCenter(v: boolean) { this.patch_({ isAbsHorizontalCenter: v }); }
    get isAbsVerticalCenter(): boolean { return this.flag_('isAbsVerticalCenter'); }
    set isAbsVerticalCenter(v: boolean) { this.patch_({ isAbsVerticalCenter: v }); }

    get isAlignLeft(): boolean { return this.bit_(AlignFlags.LEFT); }
    set isAlignLeft(v: boolean) { this.setBit_(AlignFlags.LEFT, v, AlignFlags.CENTER); }
    get isAlignRight(): boolean { return this.bit_(AlignFlags.RIGHT); }
    set isAlignRight(v: boolean) { this.setBit_(AlignFlags.RIGHT, v, AlignFlags.CENTER); }
    get isAlignTop(): boolean { return this.bit_(AlignFlags.TOP); }
    set isAlignTop(v: boolean) { this.setBit_(AlignFlags.TOP, v, AlignFlags.MID); }
    get isAlignBottom(): boolean { return this.bit_(AlignFlags.BOT); }
    set isAlignBottom(v: boolean) { this.setBit_(AlignFlags.BOT, v, AlignFlags.MID); }
    get isAlignHorizontalCenter(): boolean { return this.bit_(AlignFlags.CENTER); }
    set isAlignHorizontalCenter(v: boolean) { this.setBit_(AlignFlags.CENTER, v, AlignFlags.LEFT | AlignFlags.RIGHT); }
    get isAlignVerticalCenter(): boolean { return this.bit_(AlignFlags.MID); }
    set isAlignVerticalCenter(v: boolean) { this.setBit_(AlignFlags.MID, v, AlignFlags.TOP | AlignFlags.BOT); }
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
    updateAlignment(): void { alignRectAnchorsNow(this._world, this._entity, getScreenLayoutOf(this._world)); }

    /** Ask for alignment at the end of the frame, whatever the mode: a write of the settings is what the engine watches for. */
    setDirty(): void { this.patch_({ alignFlags: this.alignFlags }); this.updateAlignment(); }
}

/** Align one widget to its parent now (rotation ignored). */
export function alignWidget(widget: Widget): void { widget.updateAlignment(); }

/** How deep a node is: parents align before the children that depend on their size. */
export function depthOf(node: Node): number {
    let d = 0;
    for (let p = node.parent; p; p = p.parent) d++;
    return d;
}

registerBuiltinComponent(Widget, ['cc.Widget', 'Widget'], viewAdapter(
    Widget,
    (world, entity) => world.has(entity, RectAnchors),
    (world, entity) => { world.insert(entity, RectAnchors, {}); },
));

/** The component is the engine's; a host without the engine's UI plugin (a test, a bare app) still needs it registered for a scene to load. */
export function declareWidget(): void { registerComponent('RectAnchors', RectAnchors); }

export { ScreenLayout };
