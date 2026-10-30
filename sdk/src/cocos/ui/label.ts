// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/label.ts
 * @brief   `Label`, `LabelOutline` and `LabelShadow`: views on the engine's `Text`.
 *
 * Every field a script sets maps to a `Text` field, converted at the boundary: colours between Cocos's 0..255 and the engine's
 * 0..1, line height between pixels and a ratio of the font size, and the three enums, whose numbers agree for alignment and differ
 * for overflow (Cocos's `SHRINK` is 2, the engine's is 3). Nothing is held here: a `Label` is the `Text` on its node.
 */
import { Text, TextOverflow, type TextData } from '../../ui/core/text';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { Color } from '../math';
import { Component } from '../component';
import { UIRenderer } from './renderer';
import { registerBuiltinComponent } from '../builtins';
import { toCocosColor, toEngineColor, viewAdapter } from './view';

/** Cocos's `Label.Overflow`: NONE, CLAMP, SHRINK, RESIZE_HEIGHT. */
const Overflow = Object.freeze({ NONE: 0, CLAMP: 1, SHRINK: 2, RESIZE_HEIGHT: 3 });
const HorizontalAlign = Object.freeze({ LEFT: 0, CENTER: 1, RIGHT: 2 });
const VerticalAlign = Object.freeze({ TOP: 0, CENTER: 1, BOTTOM: 2 });
const CacheMode = Object.freeze({ NONE: 0, BITMAP: 1, CHAR: 2 });

function toEngineOverflow(cocos: number): number {
    if (cocos === Overflow.CLAMP) return TextOverflow.Clip;
    if (cocos === Overflow.SHRINK) return TextOverflow.Shrink;
    if (cocos === Overflow.RESIZE_HEIGHT) return TextOverflow.ResizeHeight;
    return TextOverflow.Visible;
}

function toCocosOverflow(engine: number): number {
    if (engine === TextOverflow.Clip || engine === TextOverflow.Ellipsis) return Overflow.CLAMP;
    if (engine === TextOverflow.Shrink) return Overflow.SHRINK;
    if (engine === TextOverflow.ResizeHeight) return Overflow.RESIZE_HEIGHT;
    return Overflow.NONE;
}

/** The `Text` data of an entity: the thing every property below reads and writes. */
export class TextView extends UIRenderer {
    protected text_(): TextData { return this._world.get(this._entity, Text); }
    protected patch_(patch: Partial<TextData>): void { this._world.set(this._entity, Text, { ...this.text_(), ...patch }); }
}

export class Label extends TextView {
    static readonly Overflow = Overflow;
    static readonly HorizontalAlign = HorizontalAlign;
    static readonly VerticalAlign = VerticalAlign;
    static readonly CacheMode = CacheMode;

    /** The text shown. A script writes `label.string = ...` more than anything else it does. */
    get string(): string { return this.text_().content; }
    set string(v: string) { this.patch_({ content: v === undefined || v === null ? '' : String(v) }); }

    get color(): Color { return toCocosColor(this.text_().color); }
    set color(v: Color) { this.patch_({ color: toEngineColor(v) }); }

    get fontSize(): number { return this.text_().fontSize; }
    set fontSize(v: number) {
        // Cocos keeps lineHeight in pixels, the engine as a ratio of the size: keep the pixel value across a size change.
        const t = this.text_();
        const px = t.lineHeight * t.fontSize;
        this.patch_({ fontSize: v, lineHeight: v > 0 ? px / v : t.lineHeight });
    }
    get actualFontSize(): number { return this.text_().fontSize; }

    get lineHeight(): number { const t = this.text_(); return t.lineHeight * t.fontSize; }
    set lineHeight(px: number) { const t = this.text_(); this.patch_({ lineHeight: t.fontSize > 0 ? px / t.fontSize : t.lineHeight }); }

    get horizontalAlign(): number { return this.text_().align; }
    set horizontalAlign(v: number) { this.patch_({ align: v as TextData['align'] }); }
    get verticalAlign(): number { return this.text_().verticalAlign; }
    set verticalAlign(v: number) { this.patch_({ verticalAlign: v as TextData['verticalAlign'] }); }

    get overflow(): number { return toCocosOverflow(this.text_().overflow); }
    set overflow(v: number) { this.patch_({ overflow: toEngineOverflow(v) as TextData['overflow'] }); }

    get enableWrapText(): boolean { return this.text_().wordWrap; }
    set enableWrapText(v: boolean) { this.patch_({ wordWrap: v }); }

    get isUnderline(): boolean { return this.text_().underline === true; }
    set isUnderline(v: boolean) { this.patch_({ underline: v }); }

    get isBold(): boolean { return this.text_().bold; }
    set isBold(v: boolean) { this.patch_({ bold: v }); }
    get isItalic(): boolean { return this.text_().italic; }
    set isItalic(v: boolean) { this.patch_({ italic: v }); }

    get fontFamily(): string { return this.text_().fontFamily; }
    set fontFamily(v: string) { this.patch_({ fontFamily: v }); }
    /** Whether a font file is not in use. Reading only: which font is drawn is `Text.font`. */
    get useSystemFont(): boolean { return !this.text_().font; }
    set useSystemFont(_v: boolean) {}

    /** The measured size of the text is the engine's layout to know; a no-op here, as a script calls it to force a refresh. */
    updateRenderData(_force = false): void {}

    get enabled(): boolean { return this.text_().enabled; }
    set enabled(v: boolean) { this.patch_({ enabled: v }); }
}

export class LabelOutline extends TextView {
    get color(): Color { return toCocosColor(this.text_().strokeColor); }
    set color(v: Color) { this.patch_({ strokeColor: toEngineColor(v) }); }
    get width(): number { return this.text_().strokeWidth; }
    set width(v: number) { this.patch_({ strokeWidth: v }); }
}

export class LabelShadow extends TextView {
    get color(): Color { return toCocosColor(this.text_().shadowColor); }
    set color(v: Color) { this.patch_({ shadowColor: toEngineColor(v) }); }
    get offset(): { x: number; y: number } { const t = this.text_(); return { x: t.shadowOffsetX, y: -t.shadowOffsetY }; }
    set offset(v: { x: number; y: number }) { this.patch_({ shadowOffsetX: v.x, shadowOffsetY: -v.y }); }
    get blur(): number { return this.text_().shadowBlur; }
    set blur(v: number) { this.patch_({ shadowBlur: v }); }
}

const hasText = (world: World, entity: Entity): boolean => world.has(entity, Text);
const addText = (world: World, entity: Entity): void => { world.insert(entity, Text, {}); };

registerBuiltinComponent(Label, ['cc.Label', 'Label'], viewAdapter(Label, hasText, addText));
// Outline and shadow are properties of the same Text: present when it has any, and adding one does not give it a visible effect until
// the script sets a width or an offset.
registerBuiltinComponent(LabelOutline, ['cc.LabelOutline', 'LabelOutline'], viewAdapter(LabelOutline, hasText, addText));
registerBuiltinComponent(LabelShadow, ['cc.LabelShadow', 'LabelShadow'], viewAdapter(LabelShadow, hasText, addText));
