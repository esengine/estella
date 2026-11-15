import {
    BlendMode, Canvas, CanvasEffect, Material, Name, ScaleMode, Text, TextAlign, TextVerticalAlign, Transform, UINode, UIPointerEvents, UIPositionType, UIVisual, UIVisualType,
    placeOnScreen, px, spawnUIEntity,
} from 'esengine';
import type { Entity, World } from 'esengine';
import { clamp } from './flight';

export type Rgba = { r: number; g: number; b: number; a: number };

export const rgb = (hex: number, a = 1): Rgba => ({ r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255, a });
export const ICE = 0xe6f2f7, HAZE = 0xa6bdc9, AMBER = 0xffa348, ALERT = 0xff5a3d;

export const DESIGN = { width: 1600, height: 900 };
export const EDGE = 40;
export const KEPT_CLEAR = { left: 12, top: 76, right: 12, bottom: 340 };
const NO_ROOM = { left: 0, top: 0, right: 0, bottom: 0 };
export const keptClear = (across: number, left: number, margin: number, onScreen: boolean): typeof KEPT_CLEAR =>
    (onScreen ? NO_ROOM : { ...KEPT_CLEAR, bottom: left > 460 && left < across - 430 ? 274 - margin : 404 - margin });
export const sameRoom = (a: typeof KEPT_CLEAR, b: typeof KEPT_CLEAR): boolean => a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

export const TEXTURES = {
    dial: 'assets/ui/gauge-dial.esimage',
    speed: 'assets/ui/gauge-speed.esimage',
    speedHot: 'assets/ui/gauge-speed-hot.esimage',
    drive: 'assets/ui/gauge-drive.esimage',
    command: 'assets/ui/gauge-command.esimage',
    plate: 'assets/ui/plate.esimage',
    barTrack: 'assets/ui/bar-track.esimage',
    barFill: 'assets/ui/bar-fill.esimage',
    bracket: 'assets/ui/bracket.esimage',
    diamond: 'assets/ui/diamond.esimage',
    chevron: 'assets/ui/chevron.esimage',
    body: 'assets/ui/body.esimage',
    dot: 'assets/ui/dot.esimage',
    pip: 'assets/ui/pip.esimage',
    keycap: 'assets/ui/keycap.esimage',
    scope: 'assets/ui/scope.esimage',
    sweep: 'assets/ui/scope-sweep.esimage',
    scan: 'assets/ui/scan.esimage',
    scrimBottom: 'assets/ui/scrim-bottom.esimage',
    scrimTop: 'assets/ui/scrim-top.esimage',
    shade: 'assets/ui/shade.esimage',
} as const;

export const MATERIALS = { lens: 'assets/ui/fx/lens.esmaterial', frost: 'assets/ui/fx/frost.esmaterial' } as const;
export type Materials = Record<keyof typeof MATERIALS, number>;
const LAYERS = { marks: 1, glass: 2 } as const;

export const FONTS = { regular: 'assets/ui/fonts/ChakraPetch-Regular.ttf', strong: 'assets/ui/fonts/ChakraPetch-SemiBold.ttf' } as const;

export type Textures = Record<keyof typeof TEXTURES, number>;

export interface Rock { entity: Entity; index: number; big: boolean }

export interface Box { left?: number; top?: number; right?: number; bottom?: number; width?: number; height?: number }

export interface Label { size: number; color: Rgba; strong?: boolean; align?: TextAlign; spacing?: number; content?: string }

export type Lens = Parameters<typeof placeOnScreen>[1];

export interface Frame {
    dt: number;
    sway: { x: number; y: number };
    time: number;
    across: number;
    lens: Lens | null;
    pointer: { left: number; top: number };
    held: (key: string) => boolean;
    pressing: boolean;
}

export interface Log { say(text: string, tone?: number): void }

export const pad = (n: number, width: number): string => String(Math.max(0, Math.round(n))).padStart(width, '0');
export const stamp = (seconds: number): string => `${pad(Math.floor(seconds / 60), 2)}:${pad(Math.floor(seconds % 60), 2)}`;
export const spaced = (n: number): string => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
export const ease = (t: number): number => { const c = clamp(t, 0, 1); return 1 - (1 - c) * (1 - c) * (1 - c); };

export type Kit = ReturnType<typeof createKit>;

export function createKit(world: World, textures: Textures, fonts: { regular: number; strong: number }, materials: Materials) {
    const node = (parent: Entity, name: string, box: Box, visual?: Parameters<typeof spawnUIEntity>[0]['visual']): Entity => {
        const e = spawnUIEntity({
            world, parent,
            node: {
                position: UIPositionType.Absolute, pointerEvents: UIPointerEvents.None,
                ...(box.left !== undefined ? { insetLeft: px(box.left) } : {}),
                ...(box.top !== undefined ? { insetTop: px(box.top) } : {}),
                ...(box.right !== undefined ? { insetRight: px(box.right) } : {}),
                ...(box.bottom !== undefined ? { insetBottom: px(box.bottom) } : {}),
                ...(box.width !== undefined ? { width: px(box.width) } : {}),
                ...(box.height !== undefined ? { height: px(box.height) } : {}),
            },
            ...(visual ? { visual } : {}),
        });
        world.insert(e, Name, { value: name });
        return e;
    };
    const image = (parent: Entity, name: string, box: Box, texture: number, color: Rgba = rgb(0xffffff)): Entity =>
        node(parent, name, box, { visualType: UIVisualType.Image, texture, color });
    const sliced = (parent: Entity, name: string, box: Box, texture: number, border: number, color: Rgba = rgb(0xffffff)): Entity =>
        node(parent, name, box, { visualType: UIVisualType.NineSlice, texture, color, sliceBorder: { x: border, y: border, z: border, w: border } });
    const solid = (parent: Entity, name: string, box: Box, color: Rgba): Entity => node(parent, name, box, { visualType: UIVisualType.SolidColor, color });
    const label = (parent: Entity, name: string, box: Box, l: Label): Entity => {
        const e = node(parent, name, box);
        world.insert(e, Text, Text.create({
            content: l.content ?? '', font: l.strong === false ? fonts.regular : fonts.strong, fontSize: l.size, color: l.color,
            align: l.align ?? TextAlign.Left, verticalAlign: TextVerticalAlign.Middle, wordWrap: false, letterSpacing: l.spacing ?? 0, lineHeight: 1,
            shadowColor: { r: 0, g: 0.02, b: 0.04, a: 0.9 }, shadowBlur: 6, shadowOffsetX: 0, shadowOffsetY: 1,
        }));
        return e;
    };
    const centred = (e: Entity, width: number, height: number): Entity => {
        world.update(e, UINode, (n) => { n.marginLeft = px(-width / 2); n.marginTop = px(-height / 2); });
        return e;
    };

    const said = new Map<Entity, string>();
    const say = (e: Entity, content: string): void => {
        if (said.get(e) === content) return;
        said.set(e, content);
        world.update(e, Text, (t) => { t.content = content; });
    };
    const inked = new Map<Entity, string>();
    const ink = (e: Entity, color: Rgba, component: typeof Text | typeof UIVisual = Text): void => {
        const key = `${color.r.toFixed(3)},${color.g.toFixed(3)},${color.b.toFixed(3)},${color.a.toFixed(3)}`;
        if (inked.get(e) === key) return;
        inked.set(e, key);
        if (component === Text) world.update(e, Text, (t) => { t.color = color; });
        else world.update(e, UIVisual, (v) => { v.color = color; });
    };
    const filled = new Map<Entity, number>();
    const fill = (e: Entity, amount: number): void => {
        const to = Math.round(clamp(amount, 0, 1) * 2000) / 2000;
        if (filled.get(e) === to) return;
        filled.set(e, to);
        world.update(e, UIVisual, (v) => { v.fillAmount = to; });
    };
    const shown = new Map<Entity, number>();
    const fade = (e: Entity, opacity: number): void => {
        const to = Math.round(clamp(opacity, 0, 1) * 100) / 100;
        if (shown.get(e) === to) return;
        shown.set(e, to);
        world.update(e, UINode, (n) => { n.opacity = to; });
    };
    const placed = new Map<Entity, string>();
    const place = (e: Entity, left: number, top: number): void => {
        const x = Math.round(left * 10) / 10, y = Math.round(top * 10) / 10;
        if (placed.get(e) === `${x},${y}`) return;
        placed.set(e, `${x},${y}`);
        world.update(e, UINode, (n) => { n.insetLeft = px(x); n.insetTop = px(y); });
    };
    const sized = new Map<Entity, string>();
    const size = (e: Entity, width: number, height: number): void => {
        const w = Math.round(width * 10) / 10, h = Math.round(height * 10) / 10;
        if (sized.get(e) === `${w},${h}`) return;
        sized.set(e, `${w},${h}`);
        world.update(e, UINode, (n) => { n.width = px(w); n.height = px(h); });
    };
    const turned = new Map<Entity, number>();
    const turn = (e: Entity, radians: number): void => {
        const to = Math.round(radians * 200) / 200;
        if (turned.get(e) === to) return;
        turned.set(e, to);
        world.update(e, Transform, (t) => { t.rotation = { x: 0, y: 0, z: Math.sin(to / 2), w: Math.cos(to / 2) }; });
    };

    const pivot = (parent: Entity, name: string, at: Box): Entity => node(parent, name, { ...at, width: 0, height: 0 });
    const tilted = new Map<Entity, string>();
    const tilt = (e: Entity, x: number, y: number, z = 0): void => {
        const key = `${Math.round(x * 500)},${Math.round(y * 500)},${Math.round(z * 500)}`;
        if (tilted.get(e) === key) return;
        tilted.set(e, key);
        const [cx, sx, cy, sy, cz, sz] = [Math.cos(x / 2), Math.sin(x / 2), Math.cos(y / 2), Math.sin(y / 2), Math.cos(z / 2), Math.sin(z / 2)];
        const q = { x: sx * cy * cz + cx * sy * sz, y: cx * sy * cz - sx * cy * sz, z: cx * cy * sz + sx * sy * cz, w: cx * cy * cz - sx * sy * sz };
        world.update(e, Transform, (t) => { t.rotation = q; });
    };

    const lift = (e: Entity, z: number): Entity => {
        world.update(e, Transform, (t) => { t.position = { x: t.position.x, y: t.position.y, z }; });
        return e;
    };
    const additive = Material.create({ shader: 0 as never, blendMode: BlendMode.Additive });
    const glow = (e: Entity): Entity => {
        world.update(e, UIVisual, (v) => { v.material = additive; });
        return e;
    };

    const frosted = (e: Entity): Entity => {
        world.update(e, UIVisual, (v) => { v.material = materials.frost; });
        return e;
    };

    const sheet = (name: string, layer: number, effect = 0): Entity => {
        const canvas = spawnUIEntity({ world, node: { pointerEvents: UIPointerEvents.None } });
        world.insert(canvas, Name, { value: name });
        world.insert(canvas, Canvas, { designResolution: { x: DESIGN.width, y: DESIGN.height }, scaleMode: ScaleMode.FixedHeight, layer });
        if (effect !== 0) world.insert(canvas, CanvasEffect, { material: effect });
        const root = spawnUIEntity({ world, parent: canvas, node: { fill: true, pointerEvents: UIPointerEvents.None } });
        world.insert(root, Name, { value: `${name}Root` });
        return root;
    };
    const marks = sheet('HudMarks', LAYERS.marks);
    const root = sheet('Hud', LAYERS.glass, materials.lens);

    return { world, root, marks, textures, frosted, node, image, sliced, solid, label, centred, pivot, tilt, lift, glow, say, ink, fill, fade, place, size, turn };
}

const HULL_BOXES: readonly (readonly number[])[] = [
    [-10.5, -6, -46, 10.5, 5.6, 6], [-7, -4.8, 6, 7, 3.6, 34], [-4, -3.6, 34, 4, 1.6, 56],
    [-5, 5.6, -36, 5, 9.4, 5], [-3.2, 9.4, -28, 3.2, 14.2, -18],
    [-21, -4.6, -46, -13, 2.6, -8], [13, -4.6, -46, 21, 2.6, -8],
];

export function hullBlocks(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): boolean {
    const origin = [from.x, from.y, from.z], along = [to.x - from.x, to.y - from.y, to.z - from.z];
    return HULL_BOXES.some((box) => {
        let enter = 0, leave = 1;
        for (let axis = 0; axis < 3; axis++) {
            const lo = box[axis]!, hi = box[axis + 3]!, o = origin[axis]!, d = along[axis]!;
            if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
            const a = (lo - o) / d, b = (hi - o) / d;
            enter = Math.max(enter, Math.min(a, b));
            leave = Math.min(leave, Math.max(a, b));
            if (enter > leave) return false;
        }
        return true;
    });
}

export function towardOnScreen(lens: Lens, point: { x: number; y: number; z: number }): number {
    const q = lens.rotation, from = lens.position;
    const v = { x: point.x - from.x, y: point.y - from.y, z: point.z - from.z };
    const tx = 2 * (-q.y * v.z + q.z * v.y), ty = 2 * (-q.z * v.x + q.x * v.z), tz = 2 * (-q.x * v.y + q.y * v.x);
    const right = v.x + q.w * tx + (-q.y * tz + q.z * ty), up = v.y + q.w * ty + (-q.z * tx + q.x * tz);
    return Math.atan2(up, right);
}
