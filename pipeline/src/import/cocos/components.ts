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
import { particleSystem } from './particle';
import type { CocosAssetEntry, CocosAssetIndex } from './assets';
import { type CocosComponent, type CocosNode } from './document';
import type { ImportReport } from './report';
import { NODE_REF } from './document';

export interface ComponentData {
    type: string;
    data: Record<string, unknown>;
}

export interface SliceBorder { left: number; right: number; top: number; bottom: number }

/** What the engine needs to know about an asset beyond its bytes, learnt from how the project uses it. */
export interface AssetHints {
    /** A bitmap font whose page carries the glyph in red and glyph-and-outline in alpha. */
    bakedOutline?: boolean;
}

/** What a Cocos material says that a MeshRenderer, a Sprite or a particle can carry: the image and tint, and how it blends and culls. */
export interface MaterialInfo {
    texture: CocosAssetEntry | null;
    /** The tint (`mainColor` or `albedo`), 0..1, when the material sets one. */
    color?: { r: number; g: number; b: number; a: number };
    normal?: CocosAssetEntry | null;
    additive: boolean;
    /** Blends with what is behind it. */
    transparent: boolean;
    /** The effect does not light the surface. */
    unlit: boolean;
    /** Faces turned away are not drawn. */
    cullBack: boolean;
    /** The effect is one of the engine's built-ins rather than the project's own shader, which is approximated. */
    builtinEffect: boolean;
}

export interface ComponentContext {
    assets: CocosAssetIndex;
    report: ImportReport;
    /** The project-relative ref of a copied asset; records that it must be copied. */
    assetRef(entry: CocosAssetEntry, slice?: SliceBorder, hints?: AssetHints): string;
    /**
     * Whether a Cocos material draws a bitmap font's page as two layers, a glyph in the red channel and its outline in alpha, with the
     * outline's colour supplied at draw time. Such a font has to say so, in the channel flags BMFont gives that layout.
     */
    drawsBakedOutline?(materialUuid: string): boolean;
    /** What a Cocos material draws and how; null when the project has no such material. */
    material?(uuid: string): MaterialInfo | null;
    /**
     * The engine MeshRenderer data of the part of a model a Cocos mesh sub-asset names, once that model was brought in. `exact` is false when
     * the part was picked because the model draws only one.
     */
    modelMesh?(uuid: string): { components: Record<string, unknown>[]; exact: boolean } | null;
    /** The engine prefab of a model a uuid names (the whole model, or its scene), or null when the uuid is not a model that was brought in. */
    modelInstance?(uuid: string): { prefab: string; rootId: string; name: string; paths: Map<string, string> } | null;
    /**
     * The `.esanimator` a Cocos animation graph is converted to for a node whose bones stand at @p paths, or null when the graph is not one of the
     * project's. A graph that plays clips of a model is written once for each skeleton it is put on.
     */
    animatorController?(graphUuid: string, paths: Map<string, string>, where: string): { ref: string; complete: boolean } | null;
    /** The timeline a Cocos `.anim` clip is converted to (project-relative), or null when the clip is not one of the project's. */
    animationClip?(clipUuid: string, where: string): string | null;
    /** The joints, by name, a skinned part of a model is bound to, in the order its vertices index them. */
    modelSkin?(meshUuid: string): string[] | null;
    /**
     * A clip of a model, ready to play on the hierarchy @p paths describes (node name to its path under the node the clip plays from): the
     * project-relative timeline, or null when the clip or its nodes are not there.
     */
    clipOn?(clipUuid: string, paths: Map<string, string>, where: string): string | null;
    /** The Cocos node an id names in the document being converted. */
    nodeById?: Map<string, CocosNode>;
    /** The script class a compressed class id names, when the project has that script. */
    scriptClass?(classId: string): { name: string } | undefined;
    /** The project-relative ref of a prefab, queuing it for conversion; null when the project does not have it. */
    prefabAssetRef?(uuid: string): string | null;
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

function label(c: CocosComponent, siblings: CocosComponent[], box: UiBox | null, ctx: ComponentContext, where: string): ComponentData {
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
        overflow: overflow === 1 ? 1 : overflow === 2 ? 3 : 0, // Clip, Shrink, otherwise Visible
        lineHeight: fontSize > 0 ? Math.round((lineHeight / fontSize) * 1000) / 1000 : 1.2,
        bold: d._isBold === true,
        italic: d._isItalic === true,
        enabled: c.enabled,
    };
    // A Label wraps, aligns and clips inside its UITransform rect, and the node origin is that rect's anchor.
    if (box) {
        data.boxWidth = box.width;
        data.boxHeight = box.height;
        data.boxPivot = { x: box.ax, y: box.ay };
    }
    if (overflow === 3) {
        status = 'partial';
        ctx.report.note('label-resize-height', where);
    }

    const fontUuid = uuidOf(d._font);
    if (d._isSystemFontUsed === false && fontUuid) {
        const font = ctx.assets.byUuid.get(fontUuid);
        if (font?.importer === 'ttf-font') {
            data.font = ctx.assetRef(font);
        } else if (font?.importer === 'bitmap-font') {
            const material = uuidOf(d._customMaterial);
            const baked = material !== '' && ctx.drawsBakedOutline?.(material) === true;
            data.font = ctx.assetRef(font, undefined, baked ? { bakedOutline: true } : undefined);
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

function richText(c: CocosComponent, box: UiBox | null, ctx: ComponentContext): ComponentData {
    const d = c.data;
    // The markup is the engine's rich-text parser's to read (it knows Cocos's tags), so the string goes across as written.
    ctx.report.component('cc.RichText', 'mapped');
    const maxWidth = num(d._maxWidth, 0);
    return {
        type: 'Text',
        data: {
            ...(box && maxWidth > 0 ? { boxWidth: maxWidth, boxHeight: box.height, boxPivot: { x: box.ax, y: box.ay } } : {}),
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
            ...(isObj(d._rect) ? { viewport: { x: num(d._rect.x, 0), y: num(d._rect.y, 0), z: num(d._rect.width, 1), w: num(d._rect.height, 1) } } : {}),
            isActive: c.enabled,
        },
    };
}

// ---------------------------------------------------------------------------
// The compatibility layer's components: UI geometry, alignment, layout, buttons, and the project's own scripts.
// ---------------------------------------------------------------------------

/** Names of the components the layer declares for built-ins; a scene that holds one needs `esengine/cocos` loaded. */
const LAYER = 'Cocos.';

/** A node's rectangle as the engine's `ContentRect`: the size, and the pivot the node's position is the position of. */
function contentRectData(box: UiBox): ComponentData {
    return { type: 'ContentRect', data: { size: { x: box.width, y: box.height }, pivot: { x: box.ax, y: box.ay } } };
}

/**
 * `cc.Mask` as the engine's `UIMask`, clipping to the node's rectangle. The rectangle mask is exact; ellipse, graphics and image masks
 * clip to the same rectangle rather than to their shape (the engine's shaped clip is a stencil cut from a sprite on the node, which a
 * Cocos mask does not carry), so those are counted as partial.
 */
function mask(c: CocosComponent, ctx: ComponentContext): ComponentData {
    ctx.report.component('cc.Mask', num(c.data._type, 0) === 0 ? 'mapped' : 'partial');
    return { type: 'UIMask', data: { enabled: c.enabled, mode: 0, alphaCutoff: 0 } };
}

/** Copy the serialised fields named in @p map to the layer's names, leaving out the ones the file does not carry. */
function renamed(c: CocosComponent, map: Record<string, string>): Raw {
    const out: Raw = { enabled: c.enabled };
    for (const [from, to] of Object.entries(map)) if (c.data[from] !== undefined) out[to] = c.data[from];
    return out;
}

function widget(c: CocosComponent): ComponentData {
    const data = renamed(c, {
        _alignFlags: 'alignFlags', _left: 'left', _right: 'right', _top: 'top', _bottom: 'bottom',
        _horizontalCenter: 'horizontalCenter', _verticalCenter: 'verticalCenter',
        _isAbsLeft: 'isAbsLeft', _isAbsRight: 'isAbsRight', _isAbsTop: 'isAbsTop', _isAbsBottom: 'isAbsBottom',
        _isAbsHorizontalCenter: 'isAbsHorizontalCenter', _isAbsVerticalCenter: 'isAbsVerticalCenter',
        _alignMode: 'alignMode', _target: 'target',
    });
    return { type: `${LAYER}Widget`, data };
}

function layout(c: CocosComponent): ComponentData {
    const data = renamed(c, {
        _layoutType: 'type', _resizeMode: 'resizeMode', _paddingLeft: 'paddingLeft', _paddingRight: 'paddingRight',
        _paddingTop: 'paddingTop', _paddingBottom: 'paddingBottom', _spacingX: 'spacingX', _spacingY: 'spacingY',
        _verticalDirection: 'verticalDirection', _horizontalDirection: 'horizontalDirection', _affectedByScale: 'affectedByScale',
        _startAxis: 'startAxis', _constraint: 'constraint', _constraintNum: 'constraintNum', _isAlign: 'isAlign',
    });
    if (isObj(c.data._cellSize)) {
        data.cellWidth = num(c.data._cellSize.width, 40);
        data.cellHeight = num(c.data._cellSize.height, 40);
    }
    return { type: `${LAYER}Layout`, data };
}

/**
 * An editor-authored handler list as the data model keeps it: the target nodes in a list of their own (they are entity references the
 * loader remaps) and the rest of each record beside it. @p prefix names the pair: `click` gives `clickTargets` / `clickHandlers`.
 */
function handlerLists(events: unknown, prefix: string, ctx: ComponentContext): Raw {
    const list = Array.isArray(events) ? events.filter(isObj) : [];
    return {
        [`${prefix}Targets`]: list.map((e) => e.target ?? null),
        [`${prefix}Handlers`]: list.map((e) => {
            const id = typeof e._componentId === 'string' ? e._componentId : '';
            const known = id ? ctx.scriptClass?.(id)?.name : undefined;
            return {
                component: known ?? (typeof e.component === 'string' ? e.component : ''),
                handler: typeof e.handler === 'string' ? e.handler : '',
                customEventData: typeof e.customEventData === 'string' ? e.customEventData : '',
            };
        }),
    };
}

const BUTTON_FIELDS: Record<string, string> = {
    _interactable: 'interactable', _transition: 'transition', _zoomScale: 'zoomScale', _duration: 'duration',
    _normalColor: 'normalColor', _hoverColor: 'hoverColor', _pressedColor: 'pressedColor', _disabledColor: 'disabledColor',
    _target: 'target',
};

function button(c: CocosComponent, ctx: ComponentContext): ComponentData {
    return { type: `${LAYER}Button`, data: { ...renamed(c, BUTTON_FIELDS), ...handlerLists(c.data.clickEvents, 'click', ctx) } };
}

function toggle(c: CocosComponent, ctx: ComponentContext): ComponentData {
    return {
        type: `${LAYER}Toggle`,
        data: {
            ...renamed(c, { ...BUTTON_FIELDS, _isChecked: 'isChecked', _checkMark: 'checkMark', _toggleGroup: 'toggleGroup' }),
            ...handlerLists(c.data.clickEvents, 'click', ctx),
            ...handlerLists(c.data.checkEvents, 'check', ctx),
        },
    };
}

function toggleContainer(c: CocosComponent, ctx: ComponentContext): ComponentData {
    return { type: `${LAYER}ToggleContainer`, data: { ...renamed(c, { _allowSwitchOff: 'allowSwitchOff' }), ...handlerLists(c.data.checkEvents, 'check', ctx) } };
}

function progressBar(c: CocosComponent): ComponentData {
    return { type: `${LAYER}ProgressBar`, data: renamed(c, { _barSprite: 'barSprite', _mode: 'mode', _totalLength: 'totalLength', _progress: 'progress_', _reverse: 'reverse' }) };
}

function slider(c: CocosComponent, ctx: ComponentContext): ComponentData {
    return { type: `${LAYER}Slider`, data: { ...renamed(c, { _handle: 'handle', _direction: 'direction', _progress: 'progress_' }), ...handlerLists(c.data.slideEvents, 'slide', ctx) } };
}

function scrollView(c: CocosComponent, ctx: ComponentContext): ComponentData {
    return {
        type: `${LAYER}ScrollView`,
        data: {
            ...renamed(c, {
                _content: 'content', horizontal: 'horizontal', vertical: 'vertical', inertia: 'inertia', brake: 'brake', elastic: 'elastic',
                bounceDuration: 'bounceDuration', cancelInnerEvents: 'cancelInnerEvents',
            }),
            ...handlerLists(c.data.scrollEvents, 'scroll', ctx),
        },
    };
}

/** A script component's fields, with asset references turned into project paths. */
function scriptValue(v: unknown, ctx: ComponentContext): unknown {
    if (Array.isArray(v)) return v.map((x) => scriptValue(x, ctx));
    if (!isObj(v)) return v;
    if (typeof v.__uuid__ === 'string') {
        const uuid = v.__uuid__;
        const prefab = ctx.prefabAssetRef?.(uuid);
        if (prefab) return prefab;
        const entry = ctx.assets.byUuid.get(uuid);
        return entry ? ctx.assetRef(entry) : '';
    }
    const out: Raw = {};
    for (const [k, x] of Object.entries(v)) out[k] = scriptValue(x, ctx);
    return out;
}

/** A sunlight: colour and strength. Cocos states strength in lux; its LDR figure is the one a game without HDR is lit by. */
function directionalLight(c: CocosComponent, ctx: ComponentContext, where: string): ComponentData {
    const d = c.data;
    ctx.report.component('cc.DirectionalLight', 'partial');
    ctx.report.note('light-intensity-units', where);
    return {
        type: 'Light',
        data: {
            type: 1, // Directional
            color: color(d._color),
            intensity: num(d._illuminanceLDR, 1),
            enabled: c.enabled,
        },
    };
}

/** Where each node under @p node stands, by name, as a path from it: what a clip addresses a node by. The first node of a name wins. */
function namePaths(node: CocosNode, ctx: ComponentContext): Map<string, string> {
    const paths = new Map<string, string>();
    const walk = (n: CocosNode, prefix: string): void => {
        for (const child of n.children) {
            const here = prefix ? `${prefix}/${child.name}` : child.name;
            if (!paths.has(child.name)) paths.set(child.name, here);
            // a model put in under this node brings its own bones, which stand below the instance
            const model = child.instance ? ctx.modelInstance?.(child.instance.asset) : null;
            if (model) for (const [name, below] of model.paths) if (!paths.has(name)) paths.set(name, `${here}/${below}`);
            walk(child, here);
        }
    };
    walk(node, '');
    return paths;
}

/** The first node of a name in the subtree under @p root, the root itself included. */
function findByName(root: CocosNode, name: string): CocosNode | null {
    if (root.name === name) return root;
    for (const child of root.children) {
        const hit = findByName(child, name);
        if (hit) return hit;
    }
    return null;
}

/**
 * `cc.SkinnedMeshRenderer`: a part of a model bound to bones that are nodes of this document. The mesh is the model's own; the joints are the
 * nodes under the skinning root that carry the names the model's skin binds, in the order the model's vertices index them.
 */
function skinnedMeshRenderer(c: CocosComponent, ctx: ComponentContext, where: string): { component: ComponentData; extra: ComponentData[] } | null {
    const mesh = meshRenderer(c, ctx, where);
    if (!mesh) return null;
    const meshUuid = uuidOf(c.data._mesh);
    const names = ctx.modelSkin?.(meshUuid);
    const rootRef = isObj(c.data._skinningRoot) ? c.data._skinningRoot[NODE_REF] : undefined;
    const root = typeof rootRef === 'string' ? ctx.nodeById?.get(rootRef) : undefined;
    if (!names || names.length === 0 || !root) {
        ctx.report.component('cc.SkinnedMeshRenderer', 'partial');
        ctx.report.note('skin-not-bound', where);
        return { component: mesh.component, extra: [] };
    }
    const joints = names.map((name) => {
        const node = findByName(root, name);
        return node ? { [NODE_REF]: node.id } : { [NODE_REF]: null };
    });
    const missing = names.filter((name) => !findByName(root, name)).length;
    ctx.report.component('cc.SkinnedMeshRenderer', missing > 0 || mesh.partial ? 'partial' : 'mapped');
    if (missing > 0) ctx.report.note('skin-joint-missing', `${where}: ${missing} of ${names.length}`);
    return { component: mesh.component, extra: [{ type: 'MeshSkin', data: { joints } }] };
}

/** `cc.Animation`: the clip it plays by default, as a timeline that plays on the node, from the start if the node asks. */
function animation(c: CocosComponent, node: CocosNode, ctx: ComponentContext, where: string): ComponentData | null {
    const clips = (Array.isArray(c.data._clips) ? c.data._clips : []).map(uuidOf).filter(Boolean);
    const wanted = uuidOf(c.data._defaultClip) || clips[0] || '';
    // a clip of the project's own, or one that lives in a model file and animates the bones below this node
    const ref = wanted ? ctx.animationClip?.(wanted, where) ?? ctx.clipOn?.(wanted, namePaths(node, ctx), where) : null;
    if (!ref) return null;
    if (clips.length > 1) ctx.report.note('animation-several-clips', where);
    ctx.report.component('cc.Animation', clips.length > 1 ? 'partial' : 'mapped');
    return { type: 'TimelinePlayer', data: { timeline: ref, playing: c.data.playOnLoad === true, speed: 1, wrapMode: '' } };
}

/** `cc.animation.AnimationController`: the graph as the engine's Animator, with its clips on this node's own bones. */
function animationController(c: CocosComponent, node: CocosNode, ctx: ComponentContext, where: string): ComponentData | null {
    const graph = uuidOf(c.data._graph) || uuidOf(c.data.graph);
    const made = graph ? ctx.animatorController?.(graph, namePaths(node, ctx), where) : null;
    if (!made) return null;
    ctx.report.component('cc.animation.AnimationController', made.complete ? 'mapped' : 'partial');
    return { type: 'Animator', data: { controller: made.ref, enabled: c.enabled } };
}

/** `cc.SkeletalAnimation`: the clip it plays by default, copied onto this node's own bones, played from the start if the node asks. */
function skeletalAnimation(c: CocosComponent, node: CocosNode, ctx: ComponentContext, where: string): ComponentData | null {
    const clips = (Array.isArray(c.data._clips) ? c.data._clips : []).map(uuidOf).filter(Boolean);
    const wanted = uuidOf(c.data._defaultClip) || clips[0] || '';
    const ref = wanted ? ctx.clipOn?.(wanted, namePaths(node, ctx), where) : null;
    if (!ref) return null;
    if (clips.length > 1) ctx.report.note('animation-several-clips', where);
    ctx.report.component('cc.SkeletalAnimation', clips.length > 1 ? 'partial' : 'mapped');
    return { type: 'TimelinePlayer', data: { timeline: ref, playing: c.data.playOnLoad === true, speed: 1, wrapMode: '' } };
}

/**
 * The shapes Cocos Creator builds in (`db://internal/primitives.fbx`), identified by the bounds of what the editor imported them to: the
 * engine's own builtin meshes, and the size of the Cocos one in world units. The engine's are 100 across, the Cocos ones about 1 (a plane 10),
 * so the node's scale carries the difference and the shape stays the size the scene meant.
 */
const COCOS_PRIMITIVES = '1263d74c-8167-4928-91a6-4e2672411f47';
const PRIMITIVE_MESHES: Record<string, { ref: string; size: number }> = {
    a804a: { ref: 'builtin:cube', size: 1 },
    '17020': { ref: 'builtin:sphere', size: 1 },
    '38fd2': { ref: 'builtin:cylinder', size: 1 },
    '2e76e': { ref: 'builtin:plane', size: 10 },
    fc873: { ref: 'builtin:quad', size: 1 },
};
const ENGINE_PRIMITIVE_SIZE = 100;

/**
 * Put a Cocos material on a MeshRenderer's data: its image and tint, whether it blends, whether it lights, which faces it draws. The material the
 * model brought is dropped then, since a material owns shading fully and would hide these. Only the first of several materials is carried.
 *
 * @returns `found`: the project had the material; `exact`: it was one of the built-in effects, so nothing of its look was approximated.
 */
function applyMaterial(data: Raw, c: CocosComponent, ctx: ComponentContext, where: string): { found: boolean; exact: boolean } {
    const uuids = (Array.isArray(c.data._materials) ? c.data._materials : []).map(uuidOf).filter(Boolean);
    const info = uuids[0] ? ctx.material?.(uuids[0]) ?? null : null;
    if (!info) {
        if (uuids.length > 0) ctx.report.note('mesh-material-missing', where);
        return { found: false, exact: false };
    }
    delete data.material;
    if (info.texture) data.texture = ctx.assetRef(info.texture);
    if (info.normal) data.normalMap = ctx.assetRef(info.normal);
    if (info.color) data.color = info.color;
    data.lit = !info.unlit;
    data.opaque = !info.transparent;
    data.cullBackfaces = info.cullBack;
    let exact = info.builtinEffect;
    if (!info.builtinEffect) ctx.report.note('mesh-custom-effect', where);
    if (uuids.length > 1) {
        exact = false;
        ctx.report.note('mesh-several-materials', where);
    }
    return { found: true, exact };
}

/** `cc.MeshRenderer`: the mesh is the model's own part, drawn with the model's own material until the Cocos material is carried across. */
function meshRenderer(c: CocosComponent, ctx: ComponentContext, where: string): { component: ComponentData; scale?: number; partial: boolean } | null {
    const meshUuid = uuidOf(c.data._mesh);
    const hasMaterial = Array.isArray(c.data._materials) && c.data._materials.some((m) => uuidOf(m) !== '');
    if (meshUuid.startsWith(COCOS_PRIMITIVES)) {
        const primitive = PRIMITIVE_MESHES[meshUuid.split('@')[1] ?? ''];
        if (!primitive) {
            ctx.report.note('mesh-builtin-shape-unknown', `${where}: ${meshUuid.split('@')[1] ?? ''}`);
            return null;
        }
        const data: Raw = { mesh: primitive.ref, enabled: c.enabled };
        const applied = applyMaterial(data, c, ctx, where);
        return { component: { type: 'MeshRenderer', data }, scale: primitive.size / ENGINE_PRIMITIVE_SIZE, partial: hasMaterial && !applied.exact };
    }
    const found = meshUuid ? ctx.modelMesh?.(meshUuid) : null;
    if (!found) {
        ctx.report.note(meshUuid ? 'mesh-model-part-not-found' : 'mesh-none', `${where}: ${meshUuid}`);
        return null;
    }
    const materials = (Array.isArray(c.data._materials) ? c.data._materials : []).map(uuidOf).filter(Boolean);
    let partial = false;
    if (found.components.length > 1) {
        partial = true;
        ctx.report.note('mesh-several-primitives', where);
    }
    if (!found.exact) {
        partial = true;
        ctx.report.note('mesh-guessed-from-model', where);
    }
    const data: Raw = { ...found.components[0]!, enabled: c.enabled };
    if (materials.length > 0) {
        const applied = applyMaterial(data, c, ctx, where);
        if (!applied.exact) partial = true;
        if (!applied.found) {
            partial = true;
            ctx.report.note('mesh-material-from-model', where);
        }
    }
    return { component: { type: 'MeshRenderer', data }, partial };
}

/** `cc.Graphics`: the style a scene stores; what is drawn is what scripts draw with it. */
function graphics(c: CocosComponent): ComponentData {
    return {
        type: `${LAYER}Graphics`,
        data: renamed(c, { _lineWidth: 'lineWidth', _lineJoin: 'lineJoin', _lineCap: 'lineCap', _miterLimit: 'miterLimit', _strokeColor: 'strokeColor', _fillColor: 'fillColor' }),
    };
}

/** `cc.UIOpacity`: the alpha of the node and everything under it, which the engine's GroupOpacity is. */
function uiOpacity(c: CocosComponent, ctx: ComponentContext): ComponentData {
    ctx.report.component('cc.UIOpacity', 'mapped');
    return { type: 'GroupOpacity', data: { opacity: Math.min(255, Math.max(0, num(c.data._opacity, 255))) / 255, enabled: c.enabled } };
}

/** `cc.Sorting`: the sorting layer and order of the renderer on the node, which the engine states for a node and its subtree. */
function sorting(c: CocosComponent, ctx: ComponentContext, where: string): ComponentData {
    const d = c.data;
    const order = num(d._sortingOrder, 0);
    const clamped = Math.min(127, Math.max(-128, Math.trunc(order)));
    if (clamped !== order) {
        ctx.report.component('cc.Sorting', 'partial');
        ctx.report.note('sorting-order-clamped', where);
    } else {
        ctx.report.component('cc.Sorting', 'mapped');
    }
    return { type: 'SortingGroup', data: { layer: Math.trunc(num(d._sortingLayer, 0)), order: clamped, enabled: c.enabled } };
}

function script(c: CocosComponent, ctx: ComponentContext): ComponentData | null {
    const cls = ctx.scriptClass?.(c.type);
    if (!cls) return null;
    const data: Raw = { enabled: c.enabled };
    for (const [k, v] of Object.entries(c.data)) data[k] = scriptValue(v, ctx);
    return { type: `${LAYER}${cls.name}`, data };
}

/** Components that are folded into another, or carry nothing of their own. */
const FOLDED = new Set(['cc.UITransform', 'cc.LabelOutline', 'cc.LabelShadow', 'cc.Canvas', 'cc.UIMeshRenderer']);

export interface ConvertedNode {
    components: ComponentData[];
    /** Everything not mapped, verbatim, for whatever consumes it next. */
    metadata?: Raw;
}

export function convertNode(node: CocosNode, ctx: ComponentContext, where: string): ConvertedNode {
    const components: ComponentData[] = [transform(node)];
    // Cocos `active` is switched-off-with-its-subtree, which is what the engine's Disabled tag means; `visible: false`
    // would instead not create the entity at all and leave its children standing on their own.
    if (!node.active) components.push({ type: 'Disabled', data: {} });
    const box = uiBox(node);
    const unmapped: Raw[] = [];
    // a mesh whose unit is not the engine's resizes the node it hangs on
    let unitScale = 1;
    // components a mapped one brings with it, added after the loop
    const extra: ComponentData[] = [];

    for (const c of node.components) {
        let out: ComponentData | null = null;
        switch (c.type) {
            case 'cc.Sprite':
                out = sprite(c, box, ctx, where);
                break;
            case 'cc.Label':
                out = label(c, node.components, box, ctx, where);
                break;
            case 'cc.RichText':
                out = richText(c, box, ctx);
                break;
            case 'cc.Camera':
                out = camera(c, ctx);
                break;
            case 'cc.UITransform':
                // Also the size the renderers below were given; this keeps the rectangle for a node that draws nothing.
                if (box) components.push(contentRectData(box));
                break;
            case 'cc.Mask':
                out = mask(c, ctx);
                break;
            case 'cc.Widget':
                out = widget(c);
                break;
            case 'cc.Layout':
                out = layout(c);
                break;
            case 'cc.Button':
                out = button(c, ctx);
                break;
            case 'cc.Toggle':
                out = toggle(c, ctx);
                break;
            case 'cc.ToggleContainer':
                out = toggleContainer(c, ctx);
                break;
            case 'cc.ProgressBar':
                out = progressBar(c);
                break;
            case 'cc.Slider':
                out = slider(c, ctx);
                break;
            case 'cc.ScrollView':
                out = scrollView(c, ctx);
                break;
            case 'cc.ParticleSystem':
                out = particleSystem(c, ctx, where);
                break;
            case 'cc.DirectionalLight':
                out = directionalLight(c, ctx, where);
                break;
            case 'cc.MeshRenderer': {
                const mesh = meshRenderer(c, ctx, where);
                out = mesh?.component ?? null;
                if (mesh) ctx.report.component('cc.MeshRenderer', mesh.partial ? 'partial' : 'mapped');
                if (mesh?.scale !== undefined) unitScale = mesh.scale;
                break;
            }
            case 'cc.SkinnedMeshRenderer': {
                const skinned = skinnedMeshRenderer(c, ctx, where);
                out = skinned?.component ?? null;
                if (skinned) extra.push(...skinned.extra);
                break;
            }
            case 'cc.animation.AnimationController':
                out = animationController(c, node, ctx, where);
                break;
            case 'cc.Animation':
                out = animation(c, node, ctx, where);
                break;
            case 'cc.SkeletalAnimation':
                out = skeletalAnimation(c, node, ctx, where);
                break;
            case 'cc.Graphics':
                out = graphics(c);
                break;
            case 'cc.UIOpacity':
                out = uiOpacity(c, ctx);
                break;
            case 'cc.Sorting':
                out = sorting(c, ctx, where);
                break;
            case 'cc.BlockInputEvents':
                out = { type: `${LAYER}BlockInputEvents`, data: { enabled: c.enabled } };
                break;
            default:
                out = c.type.startsWith('cc.') ? null : script(c, ctx);
                break;
        }
        if (out) {
            components.push(out);
            if (out.type.startsWith(LAYER)) ctx.report.component(c.type.startsWith('cc.') ? c.type : `script:${out.type.slice(LAYER.length)}`, 'mapped');
            continue;
        }
        if (FOLDED.has(c.type)) {
            // A canvas carries nothing of its own here: the design resolution is the scene's, and its camera is a component of its own.
            const host = c.type === 'cc.UITransform' || c.type === 'cc.Canvas' || c.type === 'cc.UIMeshRenderer' ? true : node.components.some((s) => s.type === 'cc.Label');
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

    components.push(...extra);
    if (unitScale !== 1) {
        const scale = components[0]!.data.scale as { x: number; y: number; z: number };
        components[0]!.data.scale = { x: scale.x * unitScale, y: scale.y * unitScale, z: scale.z * unitScale };
    }

    const cocos: Raw = {};
    if (unmapped.length) cocos.components = unmapped;
    if (box) cocos.ui = { width: box.width, height: box.height, anchorX: box.ax, anchorY: box.ay };
    if (node.layer !== 33554432 && node.layer !== 0) cocos.layer = node.layer;
    const metadata = Object.keys(cocos).length ? { cocos } : undefined;
    return metadata ? { components, metadata } : { components };
}
