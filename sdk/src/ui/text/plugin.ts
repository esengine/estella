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
import { SystemLabel } from '../../ecs/systemLabels';
import type { ESEngineModule, CppRegistry } from '../../wasm';
import type { Entity } from '../../types';
import type { World } from '../../ecs/world';
import { SdfTextRenderer } from './text-renderer';
import type { RGBA } from './layout';
import { composeTRS, DEFAULT_ASCENT, rectTextBox, UI_TEXT_BOLD, UI_TEXT_ITALIC } from './text-transform';
import { Text, TextOverflow, TextRenderMode, type TextData } from '../core/text';
import { ContentRect } from '../core/content-rect';
import { bitmapFontOf, fontAscent } from './bitmap-font';
import { UINode } from '../core/ui-node';
import { Localization } from '../../i18n/Localization';
import { applyTextLocalization, type TextWorldView } from './localize';
import { UICameraInfo, type UICameraData } from '../core/ui-camera-info';
import { ScreenOverlay } from '../core/screen-overlay';
import { getUINodeWidth, getUINodeHeight, ensureUIVisual } from '../util/helpers';
import { resolveTextFamily } from './font-registry';
import { DEFAULT_PRELOAD_BUDGET_MS, GlyphPreloadJob, preloadCodepoints, type GlyphPreload, type GlyphPreloadOptions } from './glyph-preload';
import { platformDevicePixelRatio, platformNow } from '../../platform';
import { engineApi, type EngineApi } from '../../ecs/bridge/engineApi';
import { withScratch } from '../../wasm/wasmScratch';
// UI quads use layer = base + uiOrder, off the C++ declaration that owns it.
import { UI_BASE_LAYER } from '../../wasm/constants.generated';

// Base glyph rasterization size in CSS px; the real source is this × DPR so text
// stays crisp on HiDPI displays. 64 covers common UI sizes at 1:1 or finer.
const GLYPH_BASE_SIZE = 64;



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
    perspective = false,
): 'bitmap' | 'sdf' {
    if (mode === TextRenderMode.Bitmap) return 'bitmap';
    if (mode === TextRenderMode.Sdf) return 'sdf';
    if (perspective) return 'sdf';
    if (!Number.isFinite(effectiveScale) || effectiveScale <= 0) return 'bitmap';
    return Math.abs(effectiveScale - 1) <= BITMAP_SCALE_EPSILON ? 'bitmap' : 'sdf';
}

/**
 * Pure: how many CSS pixels one unit of a DOMAIN covers, which is the size
 * bitmap glyphs must be rasterized at to land on screen pixels.
 *
 * It comes from the projection that will DRAW the text, not from the box the
 * text was laid out in: the editor's free-zoom view holds that box fixed on
 * purpose, so reading the span off it asks for design-sized glyphs and leaves the
 * projection to scale the result — which is soft text at every zoom but "fit".
 *
 * Two domains call this with their own projections. World text sharpens as the
 * camera zooms in, which is correct; screen text follows the overlay, which is
 * what keeps a 3D camera's field of view out of a HUD's glyphs.
 *
 * @param projScaleX element 0 of the projection: 2 / the span it shows.
 * @param vpW        the pixel width that span lands in.
 */
export function projectionIsPerspective(viewProjection: ArrayLike<number> | undefined): boolean {
    if (!viewProjection || viewProjection.length < 16) return false;
    return Math.abs(viewProjection[3]) + Math.abs(viewProjection[7]) + Math.abs(viewProjection[11]) > 1e-6;
}

export interface DomainView {
    contentScale: number;
    perspective: boolean;
}

const FLAT_VIEW: DomainView = { contentScale: 1, perspective: false };

export function domainViewOf(viewProjection: ArrayLike<number> | undefined, vpW: number, dpr: number): DomainView {
    if (projectionIsPerspective(viewProjection)) return { contentScale: 1, perspective: true };
    return { contentScale: glyphContentScale(viewProjection?.[0] ?? 0, vpW, dpr), perspective: false };
}

export function glyphKind(t: Pick<TextData, 'renderMode'>, tr: Pick<TransformData, 'worldScale'>, family: string, view: DomainView): 'bitmap' | 'sdf' {
    if (bitmapFontOf(family)) return 'bitmap';
    return resolveTextRenderMode(t.renderMode, tr.worldScale.x, view.perspective);
}

export function glyphContentScale(projScaleX: number, vpW: number, dpr: number): number {
    if (!(dpr > 0) || !(vpW > 0)) return 1;
    if (!Number.isFinite(projScaleX) || projScaleX === 0) return 1;
    const shownSpan = Math.abs(2 / projScaleX);
    return shownSpan > 0 ? vpW / (shownSpan * dpr) : 1;
}

/** The box a Text is laid out in, and where the entity origin sits in it. */
export interface TextFrame {
    w: number;
    h: number;
    /** Pivot as a fraction from the box's left / bottom edge. */
    px: number;
    py: number;
    /** True when a UINode supplied the box: the label is then UI content, ordered by the UI tree. */
    ui: boolean;
}

/**
 * Where a Text gets its box. A UINode decides it, pivot-centred, as ever; without one, the Text's own box fields
 * do, with the pivot they name — so world content can wrap, align and clip inside a rect without joining a Canvas.
 * Pure over what it is given, apart from reading the node's computed size.
 */
export function textFrame(world: World, entity: Entity, t: TextData): TextFrame {
    if (world.has(entity, UINode)) return { w: getUINodeWidth(entity), h: getUINodeHeight(entity), px: 0.5, py: 0.5, ui: true };
    return { w: t.boxWidth || 0, h: t.boxHeight || 0, px: t.boxPivot?.x ?? 0.5, py: t.boxPivot?.y ?? 0.5, ui: false };
}

/** The Text fields a retained label's geometry was laid out from; a label is rebuilt when any of them differs, and not otherwise. */
export interface TextSnapshot {
    content: string; family: string; fontSize: number; bold: boolean; italic: boolean; richText: boolean; renderMode: number;
    align: number; verticalAlign: number; wordWrap: boolean; overflow: number; lineHeight: number; layer: number; underline: boolean;
    boxW: number; boxH: number; boxPx: number; boxPy: number;
    cr: number; cg: number; cb: number; ca: number;
    strokeWidth: number; sr: number; sg: number; sb: number; sa: number;
    shadowBlur: number; shadowX: number; shadowY: number; hr: number; hg: number; hb: number; ha: number;
}

/** A label whose glyph quads the engine holds (see RetainedText.hpp): what TS needs to know whether those quads are still the right ones. */
interface RetainedLabel {
    snap: TextSnapshot;
    screen: boolean;
    gen: number;
    renderer: SdfTextRenderer;
}

export function snapshotOf(t: TextData, family: string): TextSnapshot {
    return {
        content: t.content, family, fontSize: t.fontSize, bold: !!t.bold, italic: !!t.italic, richText: !!t.richText, renderMode: t.renderMode,
        align: t.align, verticalAlign: t.verticalAlign, wordWrap: !!t.wordWrap, overflow: t.overflow, lineHeight: t.lineHeight, layer: t.layer | 0, underline: !!t.underline,
        boxW: t.boxWidth || 0, boxH: t.boxHeight || 0, boxPx: t.boxPivot?.x ?? 0.5, boxPy: t.boxPivot?.y ?? 0.5,
        cr: t.color.r, cg: t.color.g, cb: t.color.b, ca: t.color.a,
        strokeWidth: t.strokeWidth, sr: t.strokeColor.r, sg: t.strokeColor.g, sb: t.strokeColor.b, sa: t.strokeColor.a,
        shadowBlur: t.shadowBlur, shadowX: t.shadowOffsetX, shadowY: t.shadowOffsetY,
        hr: t.shadowColor.r, hg: t.shadowColor.g, hb: t.shadowColor.b, ha: t.shadowColor.a,
    };
}

export function sameSnapshot(s: TextSnapshot, t: TextData, family: string): boolean {
    return s.content === t.content && s.family === family && s.fontSize === t.fontSize
        && s.bold === !!t.bold && s.italic === !!t.italic && s.richText === !!t.richText && s.renderMode === t.renderMode
        && s.align === t.align && s.verticalAlign === t.verticalAlign && s.wordWrap === !!t.wordWrap
        && s.overflow === t.overflow && s.lineHeight === t.lineHeight && s.layer === (t.layer | 0) && s.underline === !!t.underline
        && s.boxW === (t.boxWidth || 0) && s.boxH === (t.boxHeight || 0) && s.boxPx === (t.boxPivot?.x ?? 0.5) && s.boxPy === (t.boxPivot?.y ?? 0.5)
        && s.cr === t.color.r && s.cg === t.color.g && s.cb === t.color.b && s.ca === t.color.a
        && s.strokeWidth === t.strokeWidth
        && s.sr === t.strokeColor.r && s.sg === t.strokeColor.g && s.sb === t.strokeColor.b && s.sa === t.strokeColor.a
        && s.shadowBlur === t.shadowBlur && s.shadowX === t.shadowOffsetX && s.shadowY === t.shadowOffsetY
        && s.hr === t.shadowColor.r && s.hg === t.shadowColor.g && s.hb === t.shadowColor.b && s.ha === t.shadowColor.a;
}

/** How many frames a preload waits for the projection before it takes the size it can get. */
const PRELOAD_PROJECTION_FRAMES = 30;

/** One preload and where it stands. The object is also what holds its atlas pages. */
interface PreloadRun {
    entity: Entity;
    framesWaited: number;
    renderer: SdfTextRenderer | null;
    job: GlyphPreloadJob;
}

/** The two domains a Text can belong to, and the state each keeps. */
interface TextDomainState {
    bitmap: SdfTextRenderer | null;
    sdf: SdfTextRenderer | null;
}

export class TextPlugin implements Plugin {
    name = 'text';

    private readonly states_ = new WeakMap<App, {
        world: TextDomainState;
        screen: TextDomainState;
        matrix: Float32Array;
        matrixHeap: Float32Array | null;
        retained: Map<number, RetainedLabel>;
        preloads: PreloadRun[];
    }>();

    /** Apps this plugin was built on: only those step a preload. */
    private readonly built_ = new WeakSet<App>();

    private stateFor(app: App) {
        let state = this.states_.get(app);
        if (!state) {
            state = {
                world: { bitmap: null, sdf: null },
                screen: { bitmap: null, sdf: null },
                matrix: new Float32Array(16), matrixHeap: null,
                retained: new Map(),
                preloads: [],
            };
            this.states_.set(app, state);
        }
        return state;
    }

    cleanup(app?: App): void {
        if (!app) return;
        const state = this.states_.get(app);
        if (!state) return;
        this.states_.delete(app);
        for (const run of state.preloads) run.job.finish();
        const errors: unknown[] = [];
        for (const renderer of [state.world.bitmap, state.world.sdf, state.screen.bitmap, state.screen.sdf]) {
            try { renderer?.dispose(); } catch (error) { errors.push(error); }
        }
        if (errors.length) throw new Error(`Failed to release text resources: ${errors.map(String).join('; ')}`);
    }

    build(app: App): void {
        registerComponent('Text', Text);
        this.built_.add(app);

        const world = app.world;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], () => {
            const state = this.states_.get(app);
            if (!state) return;
            for (const renderer of [state.world.bitmap, state.world.sdf, state.screen.bitmap, state.screen.sdf]) {
                renderer?.beginFrame();
            }
        }, { name: 'TextPageLifetimeSystem', runWhenPaused: true }));

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], () => {
            const state = this.states_.get(app);
            if (state && state.preloads.length > 0) this.stepPreloads(app, state.preloads);
        }, { name: 'TextGlyphPreloadSystem', runWhenPaused: true }));

        // A Text node inside a UINode is a UI render node: ensure it carries a
        // UIVisual (visualType None — not drawn as a quad) so the UI
        // render-order pass assigns it a uiOrder and the SDF glyphs sort with
        // sibling UI elements. Idempotent; runs before the PostUpdate order pass.
        const ensureTextRenderNodes = (): void => {
            for (const e of world.getEntitiesWithComponents([Text, UINode])) {
                ensureUIVisual(world, e as Entity);
            }
        };
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], ensureTextRenderNodes, { name: 'TextRenderNodeSystem', runWhenPaused: true }));
        // A Text spawned in Update is not seen by the PreUpdate pass, so it would
        // reach the order pass with no UIVisual, take no uiOrder, and be drawn at
        // the base layer — under every panel — for its first frame. The late pass
        // gives it one before the order is assigned.
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([], ensureTextRenderNodes, {
            name: 'TextRenderNodeLateSystem',
            runWhenPaused: true,
            runBefore: [SystemLabel.UIRenderOrder],
        }));

        // Localized text: an `i18nKey` binds content to the Localization
        // resource. Gated per frame on the resource so localizationPlugin
        // stays opt-in and install order doesn't matter; without it, authored
        // content stands (see ui/text/localize.ts for the resolve contract).
        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem([], () => {
            if (!app.hasResource(Localization)) return;
            applyTextLocalization(world as unknown as TextWorldView, app.getResource(Localization));
        }, { name: 'TextLocalizeSystem', runWhenPaused: true }));

        const pipeline = app.pipeline;
        if (!pipeline) return; // logic-only host → nothing to draw

        // Two passes, because there are two lists: the world's glyphs go into the
        // camera being collected, the screen's into the frame's overlay.
        pipeline.addPreFlushCallback((_registry, projection) => this.drawDomain(app, /*screen=*/false, projection));
        pipeline.addScreenOverlayCallback((_registry, projection) => this.drawDomain(app, /*screen=*/true, projection));
    }

    /**
     * Draw every Text belonging to one domain, into whichever list is open.
     *
     * The domain is asked of the engine, not derived here: it is resolved once at
     * a UI subtree's root and inherited (UISystem::screenDomain), and a second
     * spelling of that rule in TS is a second rule.
     */
    private drawDomain(app: App, screen: boolean, projection?: Float32Array): void {
        const appState = this.stateFor(app);
        const api = engineApi(app);
        if (this.canRetain(api)) {
            this.drawRetained(app, api!, screen, projection);
            return;
        }
        if (!api?.transform_copyFlatRenderMatrix || !api.HEAPU8 || !api._malloc || !api._free) {
            this.drawDomainWithMatrix(app, screen, undefined, projection);
            return;
        }
        const registry = app.world.getCppRegistry() as CppRegistry;
        withScratch({ _malloc: size => api._malloc!(size), _free: ptr => api._free!(ptr) }, alloc => {
            let pointer = 0;
            this.drawDomainWithMatrix(app, screen, entity => {
                if (!pointer) pointer = alloc(16 * 4);
                if (!pointer) throw new Error('Could not allocate text transform scratch.');
                if (!api.transform_copyFlatRenderMatrix!(registry, entity, pointer)) return false;
                const heap = api.HEAPU8!;
                if (appState.matrixHeap?.buffer !== heap.buffer) appState.matrixHeap = new Float32Array(heap.buffer);
                const offset = (heap.byteOffset + pointer) / 4;
                for (let i = 0; i < 16; i++) appState.matrix[i] = appState.matrixHeap[offset + i]!;
                return true;
            }, projection);
        });
    }

    /**
     * Whether the engine can keep a label's glyph quads and submit them itself. A core without the entry points (an older native host) takes the
     * path that hands every label over every frame.
     */
    private canRetain(api: EngineApi | null): boolean {
        return !!api && !!api.renderer_retainedTextBegin && !!api.renderer_retainedTextBatch && !!api.renderer_retainedTextClear
            && !!api.renderer_retainedTextStale && !!api.renderer_retainedTextSubmit && !!api.ui_isScreenDomain
            && !!api.HEAPU8 && !!api._malloc && !!api._free;
    }

    /**
     * One domain's Text, with the glyph quads kept by the engine: a label that is the same as the last time costs a comparison here and the
     * engine's own loop, and is laid out again only when its text, style or box changed.
     */
    private drawRetained(app: App, api: EngineApi, screen: boolean, projection?: Float32Array): void {
        const appState = this.stateFor(app);
        const world = app.world;
        const registry = world.getCppRegistry() as CppRegistry;
        const dpr = platformDevicePixelRatio();
        const contentScale = this.domainView(app, screen, dpr).contentScale;
        const state = screen ? appState.screen : appState.world;
        const retained = appState.retained;
        // The atlas rasterizes for the projection that draws it: bring each existing renderer up to this pass's before asking whether its
        // generation moved.
        if (state.bitmap) {
            state.bitmap.setDevicePixelRatio(dpr);
            state.bitmap.setContentScale(contentScale);
        }

        // What the engine says no longer matches the world: a box that was resized, a label that moved between domains.
        this.rebuildStale(app, api, registry);

        const seen = new Set<number>();
        for (const e of world.getEntitiesWithComponents([Text, Transform])) {
            const entity = e as Entity;
            const label = retained.get(entity as number);
            if (label && label.screen !== screen) continue; // the other domain's pass owns it
            const t = world.get(entity, Text) as TextData;
            if (!t.content || t.enabled === false) continue; // not seen: swept below
            if (!label && api.ui_isScreenDomain!(registry, entity as number) !== screen) continue;
            const family = resolveTextFamily(t.font, t.fontFamily);
            seen.add(entity as number);
            // Which glyph pipeline an automatic label gets follows its world scale, which the engine watches (renderer_retainedTextStale): the
            // transform is not read here every frame for every label to find out.
            if (label && label.gen === label.renderer.atlas.generation && sameSnapshot(label.snap, t, family)) {
                label.renderer.markDrawn(entity as number);
                continue;
            }
            this.layoutRetained(app, api, registry, entity, t, screen);
        }
        for (const [entity, label] of retained) {
            if (label.screen !== screen || seen.has(entity)) continue;
            api.renderer_retainedTextClear!(entity);
            label.renderer.forget(entity);
            retained.delete(entity);
        }

        withScratch({ _malloc: size => api._malloc!(size), _free: ptr => api._free!(ptr) }, alloc => {
            let projectionPtr = 0;
            if (projection && projection.length >= 16) {
                projectionPtr = alloc(16 * 4);
                api.HEAPU8!.set(new Uint8Array(projection.buffer, projection.byteOffset, 16 * 4), projectionPtr);
            }
            api.renderer_retainedTextSubmit!(registry, screen ? 1 : 0, projectionPtr);
        });
    }

    /** Lay the labels the engine reports stale out again, in the domain they are in now. */
    private rebuildStale(app: App, api: EngineApi, registry: CppRegistry): void {
        const appState = this.stateFor(app);
        const world = app.world;
        const CAPACITY = 256;
        for (let round = 0; round < 8; round++) {
            const stale: number[] = [];
            withScratch({ _malloc: size => api._malloc!(size), _free: ptr => api._free!(ptr) }, alloc => {
                const ptr = alloc(CAPACITY * 4);
                const count = api.renderer_retainedTextStale!(registry, ptr, CAPACITY);
                const ids = new Uint32Array(api.HEAPU8!.buffer, ptr, count);
                for (let i = 0; i < count; i++) stale.push(ids[i]!);
            });
            for (const entity of stale) {
                const label = appState.retained.get(entity);
                const alive = world.valid(entity as Entity) && world.has(entity as Entity, Text);
                const t = alive ? world.get(entity as Entity, Text) as TextData : null;
                if (!t || !t.content || t.enabled === false) {
                    api.renderer_retainedTextClear!(entity);
                    label?.renderer.forget(entity);
                    appState.retained.delete(entity);
                    continue;
                }
                this.layoutRetained(app, api, registry, entity as Entity, t, api.ui_isScreenDomain!(registry, entity));
            }
            if (stale.length < CAPACITY) return;
        }
    }

    /** Lay one label out in @p screen's domain and give the engine its quads. */
    private layoutRetained(
        app: App, api: EngineApi, registry: CppRegistry,
        entity: Entity, t: TextData, screen: boolean,
    ): void {
        const appState = this.stateFor(app);
        const world = app.world;
        const dpr = platformDevicePixelRatio();
        const view = this.domainView(app, screen, dpr);
        const state = screen ? appState.screen : appState.world;
        const tr = world.get(entity, Transform) as TransformData;
        const family = resolveTextFamily(t.font, t.fontFamily);
        const kind = glyphKind(t, tr, family, view);
        const renderer = this.rendererFor(app, state, kind, view.contentScale, dpr);
        const previous = appState.retained.get(entity as number);
        if (previous && previous.renderer !== renderer) previous.renderer.forget(entity as number);

        const style = (t.bold ? UI_TEXT_BOLD : 0) | (t.italic ? UI_TEXT_ITALIC : 0);
        // Text.lineHeight is a ratio of fontSize (legacy convention).
        const lineHeightPx = t.lineHeight > 0 ? t.lineHeight * t.fontSize : undefined;
        let originX: number | undefined;
        let originY: number | undefined;
        let maxWidth: number | undefined;
        let boxWidth: number | undefined;
        let boxHeight: number | undefined;
        const frame = textFrame(world, entity, t);
        const w = frame.w, h = frame.h;
        const hasBox = w > 0 || h > 0;
        if (hasBox) {
            const box = rectTextBox(frame.px, frame.py, w, h, t.fontSize, fontAscent(family, DEFAULT_ASCENT));
            originX = box.originX;
            originY = box.originY;
            boxWidth = box.maxWidth; // align within the box regardless of word-wrap
            boxHeight = box.boxHeight;
            if (t.wordWrap) maxWidth = box.maxWidth; // wrap only when enabled
        }
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
        const blockHeight = renderer.retain(
            api,
            {
                text: t.content,
                fontFamily: family,
                fontSizePx: t.fontSize,
                color: [t.color.r, t.color.g, t.color.b, t.color.a],
                style,
                richText: t.richText,
                align: t.align,
                verticalAlign: t.verticalAlign,
                lineHeight: lineHeightPx,
                maxWidth,
                boxWidth,
                boxHeight,
                overflow: t.overflow,
                underline: !!t.underline,
                originX,
                originY,
                shadow,
                outline,
            },
            // The engine orders a boxed label by the UI tree and re-lays it out when the node's size changes; a box
            // that is the Text's own is neither, so it is reported as no box (its size reaches layout above).
            entity as number, screen, hasBox && frame.ui, t.layer | 0, frame.ui ? w : 0, frame.ui ? h : 0,
            t.renderMode !== TextRenderMode.Bitmap && t.renderMode !== TextRenderMode.Sdf && !bitmapFontOf(family),
        );
        appState.retained.set(entity as number, { snap: snapshotOf(t, family), screen, gen: renderer.atlas.generation, renderer });
        // A box that grows to its text: the rectangle the entity occupies takes the height the lines laid out to. The sprite and text follow the
        // rectangle on the next frame, where the box is the same height and nothing changes again.
        if (t.overflow === TextOverflow.ResizeHeight && blockHeight > 0) {
            const rect = world.tryGet(entity, ContentRect);
            if (rect && Math.abs(rect.size.y - blockHeight) > 0.5) world.set(entity, ContentRect, { ...rect, size: { x: rect.size.x, y: blockHeight } });
        }
    }

    private drawDomainWithMatrix(app: App, screen: boolean, readMatrix?: (entity: number) => boolean, projection?: Float32Array): void {
        const appState = this.stateFor(app);
        const world = app.world;
        const registry = world.getCppRegistry() as CppRegistry;
        // Through engineApi, not app.wasmModule: a device has no wasm module, and
        // asking for one leaves every Text at the base UI layer (ecs/engineApi.ts).
        const api = engineApi(app);
        // A core that cannot answer has not partitioned anything either, so every
        // Text is world content and the screen pass draws nothing.
        const isScreen = (entity: number): boolean =>
            api?.ui_isScreenDomain?.(registry, entity) ?? false;
        if (screen && !api?.ui_isScreenDomain) return;

        const dpr = platformDevicePixelRatio();
        const view = this.domainView(app, screen, dpr);
        const state = screen ? appState.screen : appState.world;

        const seen = new Set<number>();
        for (const e of world.getEntitiesWithComponents([Text, Transform])) {
            const entity = e as Entity;
            if (isScreen(entity as number) !== screen) continue;
            const t = world.get(entity, Text) as TextData;
            // enabled === false: pre-upgrade data lacks the field → visible.
            if (!t.content || t.enabled === false) continue;
            // display:none anywhere up the UI tree hides this text too.
            if (api?.getUINodeHiddenInTree?.(registry, entity)) continue;
            const groupAlpha = api?.getUINodeAlphaInTree?.(registry, entity) ?? 1;
            if (groupAlpha <= 0) continue;
            if (readMatrix && !readMatrix(entity as number)) continue;
            seen.add(entity as number);

            const tr = world.get(entity, Transform) as TransformData;
            const renderer = this.rendererFor(
                app, state,
                glyphKind(t, tr, resolveTextFamily(t.font, t.fontFamily), view),
                view.contentScale,
                dpr,
            );
            if (!readMatrix) composeTRS(appState.matrix, tr.worldPosition, tr.worldRotation, tr.worldScale);

            const style = (t.bold ? UI_TEXT_BOLD : 0) | (t.italic ? UI_TEXT_ITALIC : 0);
            // Text.lineHeight is a ratio of fontSize (legacy convention).
            const lineHeightPx = t.lineHeight > 0 ? t.lineHeight * t.fontSize : undefined;

            // The layout box: a UINode (CSS box, pivot-centered), which places,
            // aligns and wraps the text and sorts it by UI render order. No box ⇒
            // a world label at the entity origin, sorted by Text.layer.
            let originX: number | undefined;
            let originY: number | undefined;
            let maxWidth: number | undefined;
            let boxWidth: number | undefined;
            let boxHeight: number | undefined;
            let layer = t.layer | 0;
            const frame = textFrame(world, entity, t);
            const hasBox = frame.w > 0 || frame.h > 0;
            if (hasBox) {
                const box = rectTextBox(frame.px, frame.py, frame.w, frame.h, t.fontSize, fontAscent(resolveTextFamily(t.font, t.fontFamily), DEFAULT_ASCENT));
                originX = box.originX;
                originY = box.originY;
                boxWidth = box.maxWidth; // align within the box regardless of word-wrap
                boxHeight = box.boxHeight;
                if (t.wordWrap) maxWidth = box.maxWidth; // wrap only when enabled

                if (frame.ui) {
                    const order = api?.ui_getRenderOrder?.(registry, entity as number) ?? -1;
                    layer = order >= 0 ? UI_BASE_LAYER + order : UI_BASE_LAYER;
                }
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
                    color: [t.color.r, t.color.g, t.color.b, t.color.a],
                    opacity: groupAlpha,
                    style,
                    richText: t.richText,
                    align: t.align,
                    verticalAlign: t.verticalAlign,
                    lineHeight: lineHeightPx,
                    maxWidth,
                    boxWidth,
                    boxHeight,
                    overflow: t.overflow,
                    originX,
                    originY,
                    shadow,
                    outline,
                },
                appState.matrix,
                entity as number,
                layer,
                // Screen draws all share one depth: their order is the UI tree's,
                // and a z left on a screen root would otherwise outrank a sibling.
                screen ? 0 : tr.worldPosition.z,
                api?.ui_getCullBit?.(registry, entity as number) ?? 0,
                projection,
            );
        }

        // Release cached geometry for text that vanished / hid this frame. Per
        // domain, because each keeps its own atlases: retaining across the two
        // would have each pass evict the other's glyphs every frame.
        state.bitmap?.retainOnly(seen);
        state.sdf?.retainOnly(seen);
    }

    /**
     * Put the glyphs of @p text on the atlas ahead of time, a slice a frame, as @p entity's Text will draw them: its font, size, style and
     * pipeline, in its domain. Everything is read from the Text rather than asked for again, since a glyph at another size or in another
     * atlas is a different cell and preloading it would buy nothing. See {@link preloadGlyphs}.
     */
    preload(app: App, entity: Entity, text: string, options: GlyphPreloadOptions = {}): GlyphPreload {
        const budgetMs = options.budgetMs !== undefined && options.budgetMs > 0 ? options.budgetMs : DEFAULT_PRELOAD_BUDGET_MS;
        const state = this.stateFor(app);
        const run: PreloadRun = {
            entity,
            framesWaited: 0,
            renderer: null,
            job: new GlyphPreloadJob(preloadCodepoints(text), budgetMs, () => {
                run.renderer?.releasePreload(run);
                const at = state.preloads.indexOf(run);
                if (at >= 0) state.preloads.splice(at, 1);
            }),
        };
        // With nothing to draw with (a logic-only host) there is no atlas to fill.
        if (!this.built_.has(app) || !app.pipeline) run.job.finish();
        if (!run.job.finished) state.preloads.push(run);
        return run.job;
    }

    private stepPreloads(app: App, runs: PreloadRun[]): void {
        // One at a time, so that the budget is the frame's and not each preload's.
        const run = runs.find((r) => !r.job.finished);
        if (!run) return;
        const world = app.world;
        if (!world.valid(run.entity) || !world.has(run.entity, Text) || !world.has(run.entity, Transform)) {
            run.job.finish();
            return;
        }
        const api = engineApi(app);
        const registry = world.getCppRegistry() as CppRegistry | null;
        const screen = !!(api?.ui_isScreenDomain && registry) && api.ui_isScreenDomain(registry, run.entity as number);
        // Bitmap glyphs are rasterized for the projection that draws them, which is known from the first frame on. Asked before it, they would
        // be another size than the ones drawn. A scene that never has one draws no text, so this does not wait for ever.
        if (!this.projectionKnown(app, screen) && run.framesWaited++ < PRELOAD_PROJECTION_FRAMES) return;

        const t = world.get(run.entity, Text) as TextData;
        const tr = world.get(run.entity, Transform) as TransformData;
        const family = resolveTextFamily(t.font, t.fontFamily);
        const dpr = platformDevicePixelRatio();
        const view = this.domainView(app, screen, dpr);
        const appState = this.stateFor(app);
        const renderer = this.rendererFor(app, screen ? appState.screen : appState.world, glyphKind(t, tr, family, view), view.contentScale, dpr);
        run.renderer = renderer;
        const style = (t.bold ? UI_TEXT_BOLD : 0) | (t.italic ? UI_TEXT_ITALIC : 0);
        run.job.step((codepoint) => renderer.preloadGlyph(run, codepoint, family, style, t.fontSize), platformNow);
    }

    private projectionKnown(app: App, screen: boolean): boolean {
        if (screen) return app.hasResource(ScreenOverlay) && app.getResource(ScreenOverlay).active;
        return !!(app.getResource(UICameraInfo) as UICameraData | undefined)?.valid;
    }

    private domainView(app: App, screen: boolean, dpr: number): DomainView {
        if (screen) {
            if (!app.hasResource(ScreenOverlay)) return FLAT_VIEW;
            const overlay = app.getResource(ScreenOverlay);
            return overlay.active ? domainViewOf(overlay.projection, overlay.vpW, dpr) : FLAT_VIEW;
        }
        const cam = app.getResource(UICameraInfo) as UICameraData | undefined;
        return cam?.valid ? domainViewOf(cam.viewProjection, cam.vpW, dpr) : FLAT_VIEW;
    }

    /** The two glyph pipelines of one domain, created lazily; they share layout,
     *  page store, and batch submit — only the atlas contents and shader
     *  coverage differ. */
    private rendererFor(
        app: App,
        state: TextDomainState,
        kind: 'bitmap' | 'sdf',
        contentScale: number,
        dpr: number,
    ): SdfTextRenderer {
        const module = app.wasmModule as ESEngineModule | null;
        if (kind === 'sdf') {
            if (!state.sdf) state.sdf = new SdfTextRenderer(module, { sdf: true });
            return state.sdf;
        }
        if (!state.bitmap) {
            state.bitmap = new SdfTextRenderer(module, {
                sdf: false, dpr, renderSize: Math.round(GLYPH_BASE_SIZE * dpr),
            });
        }
        state.bitmap.setDevicePixelRatio(dpr);
        state.bitmap.setContentScale(contentScale);
        return state.bitmap;
    }
}

export const textPlugin = new TextPlugin();

/**
 * Put the glyphs of @p text on the atlas before they are shown, so the frame that shows them does not pay for them. The first page of a
 * novel is hundreds of new characters, and they all land in one frame otherwise. Give it what is coming (a chapter, the next scene's
 * lines) on a loading screen and wait on `done`, or let it run behind the game: it spends `budgetMs` a frame.
 *
 * @param entity The Text that will show them, which says how they are drawn. It need not be visible.
 * @param text   Repeated characters cost nothing. Text in a rich-text size or an outline is another cell, and is made when it first shows.
 * @returns      Call `release()` when the text is over: the glyphs hold their atlas pages until then.
 */
export function preloadGlyphs(app: App, entity: Entity, text: string, options?: GlyphPreloadOptions): GlyphPreload {
    return textPlugin.preload(app, entity, text, options);
}
