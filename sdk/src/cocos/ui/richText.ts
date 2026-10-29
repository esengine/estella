// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/richText.ts
 * @brief   `RichText`: a view on the engine's `Text` with markup on.
 *
 * Nothing here parses markup. A `RichText` is a `Text` whose `richText` flag is set, and the string a script writes —
 * `<color=#ff0000>hit</color> <b>crit</b><br/>` — is handed to the engine's own rich-text parser, which reads the tags Cocos's
 * rich text uses. Tags the renderer cannot draw (underline, outline, click) keep their text and lose their style.
 */
import { Text, type TextData } from '../../ui/core/text';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { Color } from '../math';
import { registerBuiltinComponent } from '../builtins';
import { TextView } from './label';
import { toCocosColor, toEngineColor, viewAdapter } from './view';

export class RichText extends TextView {
    /** Kept so a script can read back what it set; the engine draws text, not touch handlers. */
    handleTouchEvent = true;

    get string(): string { return this.text_().content; }
    set string(v: string) { this.patch_({ content: v === undefined || v === null ? '' : String(v) }); }

    get fontSize(): number { return this.text_().fontSize; }
    set fontSize(v: number) {
        const t = this.text_();
        const px = t.lineHeight * t.fontSize;
        this.patch_({ fontSize: v, lineHeight: v > 0 ? px / v : t.lineHeight });
    }

    get lineHeight(): number { const t = this.text_(); return t.lineHeight * t.fontSize; }
    set lineHeight(px: number) { const t = this.text_(); this.patch_({ lineHeight: t.fontSize > 0 ? px / t.fontSize : t.lineHeight }); }

    get fontColor(): Color { return toCocosColor(this.text_().color); }
    set fontColor(v: Color) { this.patch_({ color: toEngineColor(v) }); }

    get horizontalAlign(): number { return this.text_().align; }
    set horizontalAlign(v: number) { this.patch_({ align: v as TextData['align'] }); }

    /** The width at which lines wrap; 0 means they do not. */
    get maxWidth(): number { const t = this.text_(); return t.wordWrap ? (t.boxWidth ?? 0) : 0; }
    set maxWidth(v: number) { this.patch_(v > 0 ? { wordWrap: true, boxWidth: v } : { wordWrap: false }); }

    get enabled(): boolean { return this.text_().enabled; }
    set enabled(v: boolean) { this.patch_({ enabled: v }); }
}

const isRich = (world: World, entity: Entity): boolean => world.has(entity, Text) && world.get(entity, Text).richText;
const addRich = (world: World, entity: Entity): void => {
    if (world.has(entity, Text)) world.set(entity, Text, { ...world.get(entity, Text), richText: true });
    else world.insert(entity, Text, { richText: true });
};

registerBuiltinComponent(RichText, ['cc.RichText', 'RichText'], viewAdapter(RichText, isRich, addRich));
