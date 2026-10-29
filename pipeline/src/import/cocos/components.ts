// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Cocos components to Estella components, one node at a time.
 *
 *        Only what has a faithful counterpart is mapped. Everything else is kept
 *        verbatim under the entity's `metadata.cocos`, so a later stage (a script
 *        shim, a Widget system) can read it and nothing is silently lost — and is
 *        counted in the report as unmapped.
 *
 *        UI note: a Cocos UI node is "anchor + content size + local position".
 *        That is a world-space `Sprite`/`Text` with a pivot, not a flex box, so
 *        UI maps there and `UITransform` is folded into it.
 */
import type { CocosAssetEntry, CocosAssetIndex } from './assets';
import type { CocosComponent, CocosNode } from './document';
import type { ImportReport } from './report';

export interface ComponentData {
    type: string;
    data: Record<string, unknown>;
}

export interface SliceBorder { left: number; right: number; top: number; bottom: number }

export interface ComponentContext {
    assets: CocosAssetIndex;
    report: ImportReport;
    /** The project-relative ref of a copied asset; records that it must be copied. */
    assetRef(entry: CocosAssetEntry, slice?: SliceBorder): string;
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

const color = (v: unknown, fallback = 1): Raw => {
    const c = isObj(v) ? v : {};
    return { r: num(c.r, 255) / 255, g: num(c.g, 255) / 255, b: num(c.b, 255) / 255, a: num(c.a, fallback * 255) / 255 };
};

const clamp012 = (v: unknown): number => Math.min(2, Math.max(0, Math.trunc(num(v, 0))));

const uuidOf = (v: unknown): string => (isObj(v) && typeof v.__uuid__ === 'string' ? v.__uuid__ : '');

/** The same value for `a` and `b`, structurally. Overrides are the fields where it is not. */
export function sameData(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a as Raw);
    const kb = Object.keys(b as Raw);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => sameData((a as Raw)[k], (b as Raw)[k]));
}

function transform(node: CocosNode): ComponentData {
    return {
        type: 'Transform',
        data: { position: { ...node.pos }, rotation: { ...node.rot }, scale: { ...node.scale } },
    };
}

interface UiBox { width: number; height: number; ax: number; ay: number }

function uiBox(node: CocosNode): UiBox | null {
    const t = node.components.find((c) => c.type === 'cc.UITransform');
    if (!t) return null;
    const s = isObj(t.data._contentSize) ? t.data._contentSize : {};
    const a = isObj(t.data._anchorPoint) ? t.data._anchorPoint : {};
    return { width: num(s.width, 100), height: num(s.height, 100), ax: num(a.x, 0.5), ay: num(a.y, 0.5) };
}

function sprite(c: CocosComponent, box: UiBox | null, ctx: ComponentContext, where: string): ComponentData | null {
    const frameUuid = uuidOf(c.data._spriteFrame);
    const data: Raw = { color: color(c.data._color), enabled: c.enabled };
    if (box) {
        data.size = { x: box.width, y: box.height };
        data.pivot = { x: box.ax, y: box.ay };
    }
    if (!frameUuid) {
        ctx.report.component('cc.Sprite', 'partial');
        ctx.report.note('sprite-no-frame', where);
        return { type: 'Sprite', data };
    }
    const entry = ctx.assets.byUuid.get(frameUuid);
    const sub = entry?.subs.get(frameUuid);
    if (!entry || !sub || entry.importer !== 'image' || sub.importer !== 'sprite-frame') {
        ctx.report.component('cc.Sprite', 'unmapped');
        ctx.report.note(entry ? 'sprite-frame-not-from-image' : 'sprite-frame-missing', where);
        if (!entry) ctx.report.missingAsset(frameUuid);
        return null;
    }

    const ud = sub.userData;
    const kind = num(c.data._type, 0);
    let status: 'mapped' | 'partial' = 'mapped';

    const border: SliceBorder = {
        left: num(ud.borderLeft, 0),
        right: num(ud.borderRight, 0),
        top: num(ud.borderTop, 0),
        bottom: num(ud.borderBottom, 0),
    };
    const hasBorder = border.left + border.right + border.top + border.bottom > 0;
    if (kind === 1 && hasBorder) {
        data.drawMode = 3; // NineSlice
        data.texture = ctx.assetRef(entry, border);
    } else {
        data.texture = ctx.assetRef(entry);
        if (kind === 2) {
            data.drawMode = 2; // Tiled
        } else if (kind === 3) {
            status = 'partial';
            ctx.report.note('sprite-filled-as-simple', where);
        }
    }

    const rawW = num(ud.rawWidth, 0);
    const rawH = num(ud.rawHeight, 0);
    const w = num(ud.width, rawW);
    const h = num(ud.height, rawH);
    const x = num(ud.trimX, 0);
    const y = num(ud.trimY, 0);
    if (rawW > 0 && rawH > 0 && (w !== rawW || h !== rawH || x !== 0 || y !== 0)) {
        data.uvOffset = { x: x / rawW, y: 1 - (y + h) / rawH };
        data.uvScale = { x: w / rawW, y: h / rawH };
        status = 'partial';
        ctx.report.note('sprite-trimmed-frame', where);
    }
    if (ud.rotated === true) {
        status = 'partial';
        ctx.report.note('sprite-rotated-frame', where);
    }
    if (c.data._useGrayscale === true) {
        status = 'partial';
        ctx.report.note('sprite-grayscale', where);
    }
    ctx.report.component('cc.Sprite', status);
    return { type: 'Sprite', data };
}

function label(c: CocosComponent, siblings: CocosComponent[], ctx: ComponentContext, where: string): ComponentData {
    const d = c.data;
    const fontSize = num(d._fontSize, 40);
    const lineHeight = num(d._lineHeight, fontSize);
    const overflow = num(d._overflow, 0);
    let status: 'mapped' | 'partial' = 'mapped';
    const data: Raw = {
        content: typeof d._string === 'string' ? d._string : '',
        fontSize,
        color: color(d._color),
        // Left/Center/Right and Top/Middle/Bottom number the same in both engines (0, 1, 2).
        align: clamp012(d._horizontalAlign),
        verticalAlign: clamp012(d._verticalAlign),
        wordWrap: d._enableWrapText !== false,
        overflow: overflow === 1 ? 1 : 0, // Clip : Visible
        lineHeight: fontSize > 0 ? Math.round((lineHeight / fontSize) * 1000) / 1000 : 1.2,
        bold: d._isBold === true,
        italic: d._isItalic === true,
        enabled: c.enabled,
    };
    if (overflow === 2 || overflow === 3) {
        status = 'partial';
        ctx.report.note(overflow === 2 ? 'label-shrink-overflow' : 'label-resize-height', where);
    }

    const fontUuid = uuidOf(d._font);
    if (d._isSystemFontUsed === false && fontUuid) {
        const font = ctx.assets.byUuid.get(fontUuid);
        if (font?.importer === 'ttf-font') {
            data.font = ctx.assetRef(font);
        } else if (font?.importer === 'bitmap-font') {
            // The engine takes a .fnt in Text.font. How its glyph scale reads `fontSize` is still to be checked on screen.
            data.font = ctx.assetRef(font);
            status = 'partial';
            ctx.report.note('label-bitmap-font', where);
        } else {
            status = 'partial';
            ctx.report.note(font ? 'label-font-unsupported' : 'label-font-missing', where);
            if (!font) ctx.report.missingAsset(fontUuid);
        }
    } else if (typeof d._fontFamily === 'string') {
        data.fontFamily = d._fontFamily;
    }
    if (d._isUnderline === true) {
        status = 'partial';
        ctx.report.note('label-underline', where);
    }

    const outline = siblings.find((s) => s.type === 'cc.LabelOutline' && s.enabled);
    if (outline) {
        data.strokeColor = color(outline.data._color);
        data.strokeWidth = num(outline.data._width, 0);
    }
    const shadow = siblings.find((s) => s.type === 'cc.LabelShadow' && s.enabled);
    if (shadow) {
        const off = isObj(shadow.data._offset) ? shadow.data._offset : {};
        data.shadowColor = color(shadow.data._color);
        data.shadowBlur = num(shadow.data._blur, 0);
        data.shadowOffsetX = num(off.x, 2);
        data.shadowOffsetY = -num(off.y, -2);
    }
    ctx.report.component('cc.Label', status);
    return { type: 'Text', data };
}

function richText(c: CocosComponent, ctx: ComponentContext): ComponentData {
    const d = c.data;
    ctx.report.component('cc.RichText', 'partial');
    return {
        type: 'Text',
        data: {
            content: typeof d._string === 'string' ? d._string : '',
            fontSize: num(d._fontSize, 40),
            color: color(d._fontColor),
            richText: true,
            wordWrap: num(d._maxWidth, 0) > 0,
            align: clamp012(d._horizontalAlign),
            enabled: c.enabled,
        },
    };
}

function camera(c: CocosComponent, ctx: ComponentContext): ComponentData {
    const d = c.data;
    ctx.report.component('cc.Camera', 'mapped');
    return {
        type: 'Camera',
        data: {
            projectionType: num(d._projection, 0) === 0 ? 1 : 0, // Orthographic : Perspective
            fov: num(d._fov, 45),
            orthoSize: num(d._orthoHeight, 10),
            nearPlane: num(d._near, 1),
            farPlane: num(d._far, 1000),
            priority: num(d._priority, 0),
            cullingMask: num(d._visibility, 0xffffffff) >>> 0,
            isActive: c.enabled,
        },
    };
}

/** Components that are folded into another, or carry nothing of their own. */
const FOLDED = new Set(['cc.UITransform', 'cc.LabelOutline', 'cc.LabelShadow']);

export interface ConvertedNode {
    components: ComponentData[];
    /** Everything not mapped, verbatim, for whatever consumes it next. */
    metadata?: Raw;
}

export function convertNode(node: CocosNode, ctx: ComponentContext, where: string): ConvertedNode {
    const components: ComponentData[] = [transform(node)];
    const box = uiBox(node);
    const unmapped: Raw[] = [];

    for (const c of node.components) {
        let out: ComponentData | null = null;
        switch (c.type) {
            case 'cc.Sprite':
                out = sprite(c, box, ctx, where);
                break;
            case 'cc.Label':
                out = label(c, node.components, ctx, where);
                break;
            case 'cc.RichText':
                out = richText(c, ctx);
                break;
            case 'cc.Camera':
                out = camera(c, ctx);
                break;
            default:
                break;
        }
        if (out) {
            components.push(out);
            continue;
        }
        if (FOLDED.has(c.type)) {
            const host = c.type === 'cc.UITransform' ? true : node.components.some((s) => s.type === 'cc.Label');
            if (host) {
                ctx.report.component(c.type, 'mapped');
                continue;
            }
        }
        if (c.type === 'cc.Sprite') {
            // the sprite counted itself unmapped; keep what it said
        } else {
            ctx.report.component(c.type, 'unmapped');
        }
        unmapped.push({ type: c.type, enabled: c.enabled, data: c.data });
    }

    const cocos: Raw = {};
    if (unmapped.length) cocos.components = unmapped;
    if (box) cocos.ui = { width: box.width, height: box.height, anchorX: box.ax, anchorY: box.ay };
    if (node.layer !== 33554432 && node.layer !== 0) cocos.layer = node.layer;
    const metadata = Object.keys(cocos).length ? { cocos } : undefined;
    return metadata ? { components, metadata } : { components };
}
