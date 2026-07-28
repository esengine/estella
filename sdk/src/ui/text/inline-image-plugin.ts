// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ui/text/inline-image-plugin.ts
 * @brief   Renders inline `<img>` runs in rich `Text`. Additive to the SDF text
 *          pipeline: `TextPlugin` still draws only glyphs, and this plugin draws
 *          the images the SHARED rich layout (`layoutText` → `TextLayout.images`)
 *          places, as child `UIVisual` image quads under each rich Text that has
 *          them. Text WITHOUT `<img>` is never touched (the scan short-circuits
 *          on the marker), so the common path carries zero cost.
 *
 * Placement rides the same layout the glyphs do (one layout, no duplication),
 * mapped from the glyph block's local space (baseline y-up) into child UINode
 * insets: `insetLeft = image.x`, `insetTop = ascent + verticalAlignShift −
 * image.y − image.h` (ascent ≈ fontSize × 0.8), matching where the glyph run
 * flows the image. Textures resolve by `src` through `Assets.loadTexture`,
 * cached; a child stays hidden until its texture lands.
 */
import type { App, Plugin } from '../../app';
import { defineSystem, Schedule } from '../../ecs/system';
import { resolveTextFamily } from './font-registry';
import type { Entity } from '../../types';
import type { ESEngineModule } from '../../wasm';
import { Text, TextVerticalAlign, type TextData } from '../core/text';
import { UINode, UIPositionType, type UINodeData } from '../core/ui-node';
import { UIVisual, UIVisualType, type UIVisualData } from '../core/ui-visual';
import { SdfTextRenderer } from './text-renderer';
import { layoutText, type LaidImage } from './layout';
import { rectTextBox, UI_TEXT_BOLD, UI_TEXT_ITALIC } from './text-transform';
import { spawnUIEntity } from '../core/compose';
import { px } from '../core/dimension';
import { getUINodeWidth, getUINodeHeight } from '../util/helpers';
import { Assets } from '../../asset/AssetPlugin';
import { log } from '../../logger';
import type { Assets as AssetsApi } from '../../asset/Assets';

const WHITE = { r: 1, g: 1, b: 1, a: 1 };

export class InlineImagePlugin implements Plugin {
    name = 'ui-inline-image';

    private cleanup_: (() => void) | null = null;

    cleanup(): void {
        this.cleanup_?.();
        this.cleanup_ = null;
    }

    build(app: App): void {
        if (!app.pipeline) return; // logic-only host → nothing to draw
        // Null on the native core, which rasterizes glyphs through the platform
        // instead of the wasm heap — the measurement atlas below takes either.
        const module = app.wasmModule as ESEngineModule | null;
        const world = app.world;

        // A measurement atlas for the shared layout — its glyph advances position
        // the images after the text runs (see `layoutText`). SDF so metrics are
        // resolution-independent; sub-pixel drift vs the draw atlas is invisible.
        let measurer: SdfTextRenderer | null = null;
        const atlas = () => (measurer ??= new SdfTextRenderer(module)).atlas;

        const childrenOf = new Map<Entity, Entity[]>();
        const textureOf = new Map<string, number>(); // src → handle (0 = failed)
        const loading = new Set<string>();

        /** Texture handle for `src`, kicking off an async load on first miss. */
        const resolveTexture = (src: string): number | null => {
            const h = textureOf.get(src);
            if (h !== undefined) return h === 0 ? null : h;
            if (!loading.has(src) && app.hasResource(Assets)) {
                loading.add(src);
                const assets = app.getResource(Assets) as AssetsApi;
                assets.loadTexture(src)
                    .then((r) => textureOf.set(src, r.handle))
                    .catch((err: unknown) => {
                        // Cached as failed so it is attempted once — and SAID once:
                        // an image the build culled (nothing but this markup names
                        // it) otherwise just silently is not there.
                        textureOf.set(src, 0);
                        log.warn('ui', `inline image failed to load: ${src}`, err);
                    });
            }
            return null;
        };

        const despawnKids = (kids: Entity[]): void => {
            for (const k of kids) if (world.valid(k)) world.despawn(k);
        };

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], () => {
            const seen = new Set<Entity>();

            for (const e of world.getEntitiesWithComponents([Text, UINode])) {
                const t = world.get(e, Text) as TextData;
                // Short-circuit on the common case: plain / image-free text never
                // lays out here, so it costs one substring scan and nothing more.
                if (!t.richText || t.enabled === false || !t.content || !t.content.includes('<img')) continue;

                const w = getUINodeWidth(e);
                const h = getUINodeHeight(e);
                if (w <= 0 || h <= 0) continue; // inline images need a laid-out box

                const box = rectTextBox(0.5, 0.5, w, h, t.fontSize);
                const style = (t.bold ? UI_TEXT_BOLD : 0) | (t.italic ? UI_TEXT_ITALIC : 0);
                const layout = layoutText(t.content, atlas(), resolveTextFamily(t.font, t.fontFamily), {
                    fontSizePx: t.fontSize,
                    lineHeight: t.lineHeight > 0 ? t.lineHeight * t.fontSize : undefined,
                    align: t.align,
                    rich: true,
                    color: [1, 1, 1, 1],
                    maxWidth: t.wordWrap ? box.maxWidth : undefined,
                    boxWidth: box.maxWidth,
                }, style);

                const images = layout.images ?? [];
                if (images.length === 0) { reap(e); continue; }
                seen.add(e);

                // verticalAlign shifts the whole block down by the box slack — the
                // same shift `drawTextWith` applies to the glyphs (mirror it so the
                // images track the text).
                const slack = h - layout.lineHeight;
                const vshift = t.verticalAlign === TextVerticalAlign.Middle ? slack / 2
                    : t.verticalAlign === TextVerticalAlign.Bottom ? slack
                    : 0;
                syncChildren(e, t, images, vshift);
            }

            // Reap children of text that lost its images / was despawned this frame.
            for (const [e, kids] of childrenOf) {
                if (!seen.has(e)) { despawnKids(kids); childrenOf.delete(e); }
            }
        }, { name: 'InlineImageSystem' }));

        function reap(textEntity: Entity): void {
            const kids = childrenOf.get(textEntity);
            if (kids) { despawnKids(kids); childrenOf.delete(textEntity); }
        }

        function syncChildren(textEntity: Entity, t: TextData, images: LaidImage[], vshift: number): void {
            let kids = childrenOf.get(textEntity);
            if (!kids) { kids = []; childrenOf.set(textEntity, kids); }
            while (kids.length < images.length) {
                kids.push(spawnUIEntity({
                    world, parent: textEntity,
                    node: { position: UIPositionType.Absolute, insetLeft: px(0), insetTop: px(0), width: px(0), height: px(0) },
                    visual: { visualType: UIVisualType.Image, texture: 0, color: { ...WHITE }, enabled: false },
                }));
            }
            while (kids.length > images.length) {
                const k = kids.pop()!;
                if (world.valid(k)) world.despawn(k);
            }

            const ascent = t.fontSize * 0.8;
            for (let i = 0; i < images.length; i++) {
                const im = images[i];
                const tex = resolveTexture(im.src);
                syncChild(kids[i], im.x, ascent + vshift - im.y - im.h, im.w, im.h, tex, im.tint);
            }
        }

        function syncChild(
            entity: Entity, left: number, top: number, width: number, height: number,
            texture: number | null, tint: readonly [number, number, number, number] | null,
        ): void {
            const node = world.get(entity, UINode) as UINodeData;
            if (node.insetLeft.value !== left || node.insetTop.value !== top
                || node.width.value !== width || node.height.value !== height) {
                node.insetLeft = px(left);
                node.insetTop = px(top);
                node.width = px(width);
                node.height = px(height);
                world.insert(entity, UINode, node);
            }
            const v = world.get(entity, UIVisual) as UIVisualData;
            const on = texture !== null && texture !== 0;
            const col = tint ? { r: tint[0], g: tint[1], b: tint[2], a: tint[3] } : WHITE;
            if (v.enabled !== on || v.texture !== (texture ?? 0)
                || v.color.r !== col.r || v.color.g !== col.g || v.color.b !== col.b || v.color.a !== col.a) {
                v.enabled = on;
                v.texture = texture ?? 0;
                v.visualType = UIVisualType.Image;
                v.color = { ...col };
                world.insert(entity, UIVisual, v);
            }
        }

        this.cleanup_ = () => {
            for (const kids of childrenOf.values()) despawnKids(kids);
            childrenOf.clear();
        };
    }
}

export const inlineImagePlugin = new InlineImagePlugin();
