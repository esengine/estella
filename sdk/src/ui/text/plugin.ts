// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/plugin.ts
 * @brief   TextPlugin — renders the `Text` component via the dynamic glyph
 *          atlas. A pre-flush callback scans Text entities, places the text
 *          inside its UINode box (rendering never mutates layout) and draws
 *          batched glyph quads, layered with sibling UI elements. Two glyph
 *          pipelines — hinted bitmap vs SDF — routed per Text by
 *          {@link resolveTextRenderMode}.
 */
import type { App, Plugin } from '../../app/app';
import { Transform, type TransformData, registerComponent } from '../../ecs/component';
import { defineSystem, Schedule } from '../../ecs/system';
import type { ESEngineModule, CppRegistry } from '../../wasm';
import type { Entity } from '../../types';
import { SdfTextRenderer } from './text-renderer';
import type { RGBA } from './layout';
import { composeTRS, rectTextBox, UI_TEXT_BOLD, UI_TEXT_ITALIC } from './text-transform';
import { Text, TextRenderMode, type TextData } from '../core/text';
import { UINode } from '../core/ui-node';
import { Localization } from '../../i18n/Localization';
import { applyTextLocalization, type TextWorldView } from './localize';
import { UICameraInfo, type UICameraData } from '../core/ui-camera-info';
import { getUINodeWidth, getUINodeHeight, ensureUIVisual } from '../util/helpers';
import { resolveTextFamily } from './font-registry';
import { platformDevicePixelRatio } from '../../platform';
import { engineApi } from '../../ecs/bridge/engineApi';

// Base glyph rasterization size in CSS px; the real source is this × DPR so text
// stays crisp on HiDPI displays. 64 covers common UI sizes at 1:1 or finer.
const GLYPH_BASE_SIZE = 64;

// Matches C++ UIElementPlugin::UI_BASE_LAYER — UI quads use layer = base + uiOrder.
const UI_BASE_LAYER = 1000;

// Auto tolerance: a bitmap glyph still reads as pixel-exact within ±2% of 1:1.
const BITMAP_SCALE_EPSILON = 0.02;

/**
 * Pure: which glyph pipeline a Text draws with. `effectiveScale` is the
 * entity's own world scale — the residual the bitmap path can't fold into
 * rasterization (the canvas fit is, via {@link GlyphAtlas.setContentScale}).
 * Auto keeps unscaled text on hinted bitmaps and sends scaled text to SDF.
 */
export function resolveTextRenderMode(
    mode: TextRenderMode | undefined,
    effectiveScale: number,
): 'bitmap' | 'sdf' {
    if (mode === TextRenderMode.Bitmap) return 'bitmap';
    if (mode === TextRenderMode.Sdf) return 'sdf';
    if (!Number.isFinite(effectiveScale) || effectiveScale <= 0) return 'bitmap';
    return Math.abs(effectiveScale - 1) <= BITMAP_SCALE_EPSILON ? 'bitmap' : 'sdf';
}

/**
 * Pure: how many device pixels one world unit covers, which is the size bitmap
 * glyphs must be rasterized at to land on screen pixels.
 *
 * It comes from what the camera SHOWS, not from the box UI lays out in. Those
 * agree in a shipped game — the camera frames the design box — and diverge in
 * the editor, whose free-zoom view deliberately holds the layout box fixed so UI
 * does not reflow while you zoom (see syncUICameraInfo). Taking the span from
 * the layout box therefore rasterized glyphs for the design scale and left the
 * camera to scale the result, so editor text went soft at every zoom but "fit" —
 * and the sharper look of SDF there was really the bitmap path being asked for
 * the wrong size.
 *
 * An orthographic view-projection's first element is 2 / the span it covers.
 */
export function glyphContentScale(
    cam: Pick<UICameraData, 'valid' | 'vpW' | 'worldLeft' | 'worldRight' | 'viewProjection'> | undefined,
    dpr: number,
): number {
    if (!cam?.valid || !(dpr > 0)) return 1;
    const vpScaleX = cam.viewProjection?.[0] ?? 0;
    const layoutSpan = cam.worldRight - cam.worldLeft;
    const shownSpan = vpScaleX !== 0 ? Math.abs(2 / vpScaleX) : layoutSpan;
    return shownSpan > 0 ? cam.vpW / (shownSpan * dpr) : 1;
}

export class TextPlugin implements Plugin {
    name = 'text';

    private bitmapRenderer_: SdfTextRenderer | null = null;
    private sdfRenderer_: SdfTextRenderer | null = null;
    private readonly matrix_ = new Float32Array(16);

    build(app: App): void {
        registerComponent('Text', Text);

        const world = app.world;

        // A Text node inside a UINode is a UI render node: ensure it carries a
        // UIVisual (visualType None — not drawn as a quad) so the UI
        // render-order pass assigns it a uiOrder and the SDF glyphs sort with
        // sibling UI elements. Idempotent; runs before the PostUpdate order pass.
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], () => {
            for (const e of world.getEntitiesWithComponents([Text, UINode])) {
                ensureUIVisual(world, e as Entity);
            }
        }, { name: 'TextRenderNodeSystem' }));

        // Localized text: an `i18nKey` binds content to the Localization
        // resource. Gated per frame on the resource so localizationPlugin
        // stays opt-in and install order doesn't matter; without it, authored
        // content stands (see ui/text/localize.ts for the resolve contract).
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], () => {
            if (!app.hasResource(Localization)) return;
            applyTextLocalization(world as unknown as TextWorldView, app.getResource(Localization));
        }, { name: 'TextLocalizeSystem' }));

        const pipeline = app.pipeline;
        if (!pipeline) return; // logic-only host → nothing to draw

        const registry = world.getCppRegistry() as CppRegistry;

        pipeline.addPreFlushCallback(() => {
            // The engine queries below go through engineApi, not app.wasmModule: a
            // device has no wasm module, so asking for one left every Text at the
            // base UI layer — beneath any sibling panel — and hid it (ecs/engineApi.ts).
            const api = engineApi(app);
            // Design→device scale beyond DPR (vpW is device px); the bitmap
            // atlas folds it into rasterization. Resolved per frame — the
            // camera plugin may build after this one.
            const uiCamera = app.getResource(UICameraInfo) as UICameraData | undefined;
            const dpr = platformDevicePixelRatio();
            const contentScale = glyphContentScale(uiCamera, dpr);

            const seen = new Set<number>();
            for (const e of world.getEntitiesWithComponents([Text, Transform])) {
                const entity = e as Entity;
                const t = world.get(entity, Text) as TextData;
                // enabled === false: pre-upgrade data lacks the field → visible.
                if (!t.content || t.enabled === false) continue;
                // display:none anywhere up the UI tree hides this text too.
                if (api?.getUINodeHiddenInTree?.(registry, entity)) continue;
                const groupAlpha = api?.getUINodeAlphaInTree?.(registry, entity) ?? 1;
                seen.add(entity as number);

                const tr = world.get(entity, Transform) as TransformData;
                const renderer = this.rendererFor(
                    app,
                    resolveTextRenderMode(t.renderMode, tr.worldScale.x),
                    contentScale,
                );
                composeTRS(this.matrix_, tr.worldPosition, tr.worldRotation, tr.worldScale);

                const style = (t.bold ? UI_TEXT_BOLD : 0) | (t.italic ? UI_TEXT_ITALIC : 0);
                // Text.lineHeight is a ratio of fontSize (legacy convention).
                const lineHeightPx = t.lineHeight > 0 ? t.lineHeight * t.fontSize : undefined;

                // The layout box: a UINode (CSS box, pivot-centered) or legacy
                // UINode. Text is placed + aligned + wrapped inside it and sorted
                // by the UI render order. No box ⇒ a world-space label at the
                // entity origin, layer 0.
                let originX: number | undefined;
                let originY: number | undefined;
                let maxWidth: number | undefined;
                let boxWidth: number | undefined;
                let boxHeight: number | undefined;
                let layer = 0;
                let w = 0, h = 0, hasBox = false;
                if (world.has(entity, UINode)) {
                    w = getUINodeWidth(entity);
                    h = getUINodeHeight(entity);
                    hasBox = w > 0 || h > 0;
                }
                if (hasBox) {
                    const box = rectTextBox(0.5, 0.5, w, h, t.fontSize);
                    originX = box.originX;
                    originY = box.originY;
                    boxWidth = box.maxWidth; // align within the box regardless of word-wrap
                    boxHeight = box.boxHeight;
                    if (t.wordWrap) maxWidth = box.maxWidth; // wrap only when enabled

                    const order = api?.ui_getRenderOrder?.(registry, entity as number) ?? -1;
                    layer = order >= 0 ? UI_BASE_LAYER + order : UI_BASE_LAYER;
                }

                // A blur with no offset is still a shadow — a halo centred on the
                // glyphs — so it counts as one for the "is there a shadow" test.
                const shadow = t.shadowColor.a > 0
                    && (t.shadowOffsetX !== 0 || t.shadowOffsetY !== 0 || t.shadowBlur > 0)
                    ? {
                        color: [t.shadowColor.r, t.shadowColor.g, t.shadowColor.b, t.shadowColor.a] as RGBA,
                        dx: t.shadowOffsetX,
                        dy: t.shadowOffsetY,
                        blur: t.shadowBlur,
                    }
                    : undefined;
                const outline = t.strokeWidth > 0 && t.strokeColor.a > 0
                    ? {
                        color: [t.strokeColor.r, t.strokeColor.g, t.strokeColor.b, t.strokeColor.a] as RGBA,
                        width: t.strokeWidth,
                    }
                    : undefined;

                renderer.drawText(
                    {
                        text: t.content,
                        fontFamily: resolveTextFamily(t.font, t.fontFamily),
                        fontSizePx: t.fontSize,
                        // Subtree opacity (UINode.opacity) is resolved in C++ by the
                        // layout pass; text is drawn here, so it multiplies the same
                        // inherited alpha in and fades with its panel like visuals do.
                        color: [t.color.r, t.color.g, t.color.b, t.color.a * groupAlpha],
                        style,
                        richText: t.richText,
                        align: t.align,
                        verticalAlign: t.verticalAlign,
                        lineHeight: lineHeightPx,
                        maxWidth,
                        boxWidth,
                        boxHeight,
                        originX,
                        originY,
                        shadow,
                        outline,
                    },
                    this.matrix_,
                    entity as number,
                    layer,
                    tr.worldPosition.z,
                );
            }

            // Release cached geometry for text that vanished / hid this frame.
            this.bitmapRenderer_?.retainOnly(seen);
            this.sdfRenderer_?.retainOnly(seen);
        });
    }

    /** The two glyph pipelines, created lazily; they share layout, page store,
     *  and batch submit — only the atlas contents and shader coverage differ. */
    private rendererFor(app: App, kind: 'bitmap' | 'sdf', contentScale: number): SdfTextRenderer {
        const module = app.wasmModule as ESEngineModule | null;
        if (kind === 'sdf') {
            if (!this.sdfRenderer_) {
                this.sdfRenderer_ = new SdfTextRenderer(module, { sdf: true });
            }
            return this.sdfRenderer_;
        }
        if (!this.bitmapRenderer_) {
            const dpr = platformDevicePixelRatio();
            this.bitmapRenderer_ = new SdfTextRenderer(module, {
                sdf: false, dpr, renderSize: Math.round(GLYPH_BASE_SIZE * dpr),
            });
        }
        this.bitmapRenderer_.setContentScale(contentScale);
        return this.bitmapRenderer_;
    }
}

export const textPlugin = new TextPlugin();
