// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/** Draw the images placed by rich text layout as entity-owned UI visuals. */
import type { App, Plugin } from '../../app/app';
import { RuntimeOnly } from '../../ecs/component';
import { patchComponentFields } from '../../ecs/world';
import { defineSystem, Schedule } from '../../ecs/system';
import { resolveTextFamily } from './font-registry';
import type { Entity } from '../../types';
import type { ESEngineModule } from '../../wasm';
import { Text } from '../core/text';
import { UINode, UIPositionType } from '../core/ui-node';
import { UIVisual, UIVisualType } from '../core/ui-visual';
import { layoutDrawText, SdfTextRenderer } from './text-renderer';
import type { LaidImage } from './layout';
import { textDrawParams } from './text-params';
import { spawnUIEntity } from '../core/compose';
import { px } from '../core/dimension';
import { getUINodeWidth, getUINodeHeight } from '../util/helpers';
import { Assets } from '../../asset/AssetPlugin';
import { disposeAll } from '../../util/disposeAll';
import { bindAssetReferenceTracking } from '../../asset/assetReferenceTracking';
import type { Assets as AssetsApi } from '../../asset/Assets';

const WHITE = { r: 1, g: 1, b: 1, a: 1 };

interface ImageChild { entity: Entity; src?: string }

export class InlineImagePlugin implements Plugin {
    name = 'ui-inline-image';
    readonly profileDomain = 'ui';

    private readonly cleanups_ = new Map<App, () => void>();

    cleanup(app?: App): void {
        if (app) {
            const cleanup = this.cleanups_.get(app);
            this.cleanups_.delete(app);
            cleanup?.();
        } else {
            const cleanups = [...this.cleanups_.values()];
            this.cleanups_.clear();
            const errors: unknown[] = [];
            for (const cleanup of cleanups) {
                try { cleanup(); } catch (error) { errors.push(error); }
            }
            if (errors.length) throw new Error(`Failed to release inline image resources: ${errors.map(String).join('; ')}`);
        }
    }

    build(app: App): void {
        this.cleanup(app);
        if (!app.pipeline) return; // logic-only host → nothing to draw
        // Null on the native core, which rasterizes glyphs through the platform
        // instead of the wasm heap — the measurement atlas below takes either.
        const module = app.wasmModule as ESEngineModule | null;
        const world = app.world;

        // A measurement atlas for the shared layout — its glyph advances position
        // the images after the text runs (see `layoutText`). SDF so metrics are
        // resolution-independent; sub-pixel drift vs the draw atlas is invisible.
        let measurer: SdfTextRenderer | null = null;
        const atlas = () => (measurer ??= new SdfTextRenderer(module, { metricsOnly: true })).atlas;

        const childrenOf = new Map<Entity, ImageChild[]>();
        const currentAssets = () => app.hasResource(Assets) ? app.getResource(Assets) : null;
        let owner: AssetsApi | null = null;
        let epoch = -1;

        function despawn(child: ImageChild): void {
            if (world.valid(child.entity)) world.despawn(child.entity);
        }

        function clearChildren(): void {
            const batches = [...childrenOf.values()];
            childrenOf.clear();
            disposeAll(batches, kids => disposeAll(kids, despawn));
        }

        const system = defineSystem([], () => {
            const assets = currentAssets();
            if (assets !== owner || (assets?.epoch ?? -1) !== epoch) {
                clearChildren();
                owner = assets;
                epoch = assets?.epoch ?? -1;
            }
            const seen = new Set<Entity>();
            for (const e of world.getEntitiesWithComponents([Text, UINode])) {
                const t = world.get(e, Text);
                if (!t.richText || t.enabled === false || !t.content?.includes('<img')) continue;
                const w = getUINodeWidth(e, world), h = getUINodeHeight(e, world);
                if (w <= 0 || h <= 0) continue;
                const params = textDrawParams(t, resolveTextFamily(t.font, t.fontFamily), { w, h, px: 0, py: 1 });
                const { layout, baseX, originY } = layoutDrawText(atlas(), params);
                if (!layout.images?.length) continue;
                if (assets && !world.hasAssetFieldResolver) bindAssetReferenceTracking(world, assets, currentAssets);
                seen.add(e);
                let kids = childrenOf.get(e);
                if (!kids) {
                    kids = [];
                    childrenOf.set(e, kids);
                }
                while (kids.length > layout.images.length) despawn(kids.pop()!);
                for (const [i, image] of layout.images.entries()) {
                    let child = kids[i];
                    if (!child || !world.valid(child.entity)) {
                        const entity = spawnUIEntity({
                            world, parent: e, node: { position: UIPositionType.Absolute },
                            visual: { visualType: UIVisualType.Image, enabled: false },
                        });
                        world.insert(entity, RuntimeOnly);
                        child = kids[i] = { entity };
                    }
                    syncChild(child, image, baseX + image.x, -originY - image.y - image.h);
                }
            }
            for (const [e, kids] of childrenOf) {
                if (seen.has(e)) continue;
                childrenOf.delete(e);
                disposeAll(kids, despawn);
            }
        }, { name: 'InlineImageSystem', runWhenPaused: true });
        app.addSystemToSchedule(Schedule.PreUpdate, system);

        function syncChild(child: ImageChild, image: LaidImage, left: number, top: number): void {
            const { entity } = child;
            const node = world.get(entity, UINode);
            if (node.insetLeft.value !== left || node.insetTop.value !== top
                || node.width.value !== image.w || node.height.value !== image.h
                || child.src === undefined) {
                world.update(entity, UINode, draft => {
                    draft.insetLeft = px(left);
                    draft.insetTop = px(top);
                    draft.width = px(image.w);
                    draft.height = px(image.h);
                });
            }
            const visual = world.get(entity, UIVisual);
            const tint = image.tint;
            const color = tint ? { r: tint[0], g: tint[1], b: tint[2], a: tint[3] } : WHITE;
            if (child.src !== image.src) {
                patchComponentFields(world, entity, UIVisual, {
                    texture: image.src, uvOffset: { x: 0, y: 0 }, uvScale: { x: 1, y: 1 }, color, enabled: false,
                });
                child.src = image.src;
            } else if (visual.enabled !== !!visual.texture || visual.color.r !== color.r || visual.color.g !== color.g
                || visual.color.b !== color.b || visual.color.a !== color.a) {
                world.update(entity, UIVisual, draft => { draft.enabled = !!visual.texture; draft.color = { ...color }; });
            }
        }

        this.cleanups_.set(app, () => {
            try {
                app.removeSystem(system._id);
                clearChildren();
            } finally {
                const renderer = measurer;
                measurer = null;
                renderer?.dispose();
            }
        });
    }
}

export const inlineImagePlugin = new InlineImagePlugin();
