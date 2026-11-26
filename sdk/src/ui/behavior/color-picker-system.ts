// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from '../../app/app';
import type { Color, Entity, Vec2 } from '../../types';
import { Children, Name, Parent, registerComponent } from '../../ecs/component';
import { Schedule, defineSystem } from '../../ecs/system';
import { Input } from '../../input/input';
import { playModeOnly } from '../../ecs/env';
import { primaryPointerCancellationVersion } from '../../input/pointerCancellation';
import { col } from '../../math/color';
import { getResourceManager, provideTextureContent, withdrawTextureContent, textureRefill, evictTextureDimensions } from '../../wasm/resourceManager';
import { TextureContent, type CppResourceManager } from '../../wasm';
import { createTextureFromPixels, updateTextureSubregion } from '../../runtime/runtimeAssets';
import { UIColorPicker } from './color-picker';
import { UISlider } from './slider';
import { UIEvents, UIEventType } from '../core/events';
import { UINode, UIDisplay } from '../core/ui-node';
import { UIVisual, UIVisualType } from '../core/ui-visual';
import { Text } from '../core/text';
import { TextInput } from '../text/text-input';
import { px, percent } from '../core/dimension';
import { spawnUIEntity } from '../core/compose';
import { UIControlPointers } from '../input/control-pointers';
import { makeWidgetInteractable, Interactable } from '../input/interactable';
import { FocusManager } from '../input/focusable';
import { isFocusEligible } from '../input/focus-inspection';
import { createLocalTransformReader } from '../util/local-transform';
import { isScreenEntity } from '../util/ui-pick';
import { worldEngineApi } from '../../ecs/bridge/engineApi';
import { themeColors } from '../theme/tokens';
import { UIConsumesDrag } from '../input/drag-consumption';

interface State {
    color: Color;
    hsv: { h: number; s: number; v: number };
    alpha: number;
    refs: string;
    format: number;
    history: string;
    swatches: Entity[];
    off: Array<() => void>;
    swatchOff: Array<() => void>;
    editingHSV: boolean;
    plane?: { handle: number; hue: number; pixels: Uint8Array; refill: () => boolean };
}

/** Normalize malformed/imported values before they reach rendering or events. */
export function normalizePickerColor(color: Color, alphaEnabled = true): Color {
    const channel = (value: number, fallback: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
    return { r: channel(color.r, 0), g: channel(color.g, 0), b: channel(color.b, 0), a: alphaEnabled ? channel(color.a, 1) : 1 };
}

/** Shared alpha, hue and checker images; editing coordinates are not blended colors. */
function createRamps(app: App, owner: CppResourceManager): number[] {
    const upload = (width: number, height: number, values: number[]): number => createTextureFromPixels(app.wasmModule,
        { width, height, pixels: new Uint8Array(values) }, TextureContent.Retained, true,
        { filterMode: 'linear', wrapMode: 'clamp' }, owner);
    const created: number[] = [];
    try {
        created.push(upload(2, 1, [255, 255, 255, 255, 255, 255, 255, 0]));
        const hue: number[] = []; for (let i = 0; i <= 360; i++) { const c = col.fromHsv(i, 1, 1); hue.push(c.r * 255, c.g * 255, c.b * 255, 255); }
        created.push(upload(361, 1, hue));
        const checker: number[] = [], theme = themeColors(app.world);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
            const c = ((x < 4) !== (y < 4)) ? theme.control : theme.track;
            checker.push(c.r * 255, c.g * 255, c.b * 255, 255);
        }
        created.push(upload(8, 8, checker)); return created;
    } catch (error) { created.forEach(handle => owner.releaseTexture(handle)); throw error; }
}

// Bottom-first encoded colors follow the same upload/decode contract as sprites.
// White/black overlays would interpolate in linear light and change HSV meaning.
function paintPlane(pixels: Uint8Array, hue: number): void {
    const color = col.fromHsv(hue, 1, 1);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const s = x / 63, v = y / 63, at = (y * 64 + x) * 4;
        pixels[at] = Math.round(v * (1 - s + s * color.r) * 255);
        pixels[at + 1] = Math.round(v * (1 - s + s * color.g) * 255);
        pixels[at + 2] = Math.round(v * (1 - s + s * color.b) * 255);
        pixels[at + 3] = 255;
    }
}

/** @internal Composed once by UIPlugin; all state and cleanup belong to its app. */
export function installColorPickers(app: App): () => void {
    registerComponent('UIColorPicker', UIColorPicker);
    const playing = (): boolean => playModeOnly() && !app.isPaused() && !app.isExecutionHeld();
    const world = app.world, events = app.getResource(UIEvents), states = new Map<Entity, State>();
    const local = createLocalTransformReader(world), engine = worldEngineApi(world), registry = world.getCppRegistry();
    let owner: CppResourceManager | null = null, ramps: number[] = [], cancellation = primaryPointerCancellationVersion(app.getResource(Input));
    const destroy = (entity: Entity): void => {
        const state = states.get(entity); if (!state) return; states.delete(entity);
        if (state.plane) {
            const plane = state.plane;
            if (textureRefill(plane.handle) === plane.refill) withdrawTextureContent(plane.handle);
            if (getResourceManager() === owner) evictTextureDimensions(plane.handle);
            owner?.releaseTexture(plane.handle);
        }
        state.off.forEach(off => off()); state.swatchOff.forEach(off => off());
        state.swatches.forEach(e => { if (world.valid(e)) world.despawn(e); });
    };
    const child = (root: Entity, entity: Entity, component: Parameters<typeof world.has>[1]): boolean => {
        if (!entity || entity === root || !world.valid(entity) || !world.has(entity, component)) return false;
        const seen = new Set<Entity>(); let current = entity;
        while (world.valid(current) && world.has(current, Parent) && !seen.has(current)) {
            seen.add(current); current = world.get(current, Parent).entity; if (current === root) return true;
        }
        return false;
    };
    const setColor = (root: Entity, color: Color): void => {
        if (world.valid(root) && world.has(root, UIColorPicker)) world.update(root, UIColorPicker, data => { data.color = normalizePickerColor(color, data.alphaEnabled); });
    };
    const available = (entity: Entity): boolean => world.valid(entity) && world.isEntityActive(entity) && !world.isDestructionPending(entity)
        && (!world.has(entity, Interactable) || world.get(entity, Interactable).enabled)
        && !engine?.getUINodeHiddenInTree?.(registry!, entity);
    const image = (root: Entity, entity: Entity, texture: number, color: Color = { r: 1, g: 1, b: 1, a: 1 },
        offset: Vec2 = { x: 0, y: 0 }, scale: Vec2 = { x: 1, y: 1 }, tiled = false): void => {
        if (!child(root, entity, UIVisual)) return;
        const visual = world.get(entity, UIVisual);
        const visualType = tiled ? UIVisualType.Tiled : UIVisualType.Image;
        const near = (a: number, b: number): boolean => Math.abs(a - b) < .000001;
        if (visual.texture !== texture || visual.visualType !== visualType || !col.equals(visual.color, color)
            || !near(visual.uvOffset.x, offset.x) || !near(visual.uvOffset.y, offset.y) || !near(visual.uvScale.x, scale.x) || !near(visual.uvScale.y, scale.y)) {
            world.insert(entity, UIVisual, { ...visual, visualType, texture, color, uvOffset: offset, uvScale: scale, ...(tiled ? { tileSize: { x: 8, y: 8 } } : {}) });
        }
    };
    app.addSystemToSchedule(Schedule.Update, defineSystem([], () => {
        const roots = new Set(world.getEntitiesWithComponents([UIColorPicker]));
        for (const entity of states.keys()) if (!roots.has(entity) || !world.valid(entity)) destroy(entity);
        if (roots.size && !owner) { owner = getResourceManager(); if (owner) ramps = createRamps(app, owner); }
        const pointers = app.getResource(UIControlPointers).pointers, input = app.getResource(Input), focus = app.getResource(FocusManager);
        const version = primaryPointerCancellationVersion(input), cancelled = version !== cancellation; cancellation = version;
        for (const root of roots) {
            if (!world.valid(root)) continue;
            let data = world.get(root, UIColorPicker), state = states.get(root);
            for (const entity of [data.sv, data.hue, data.alpha]) if (child(root, entity, UINode) && !world.has(entity, UIConsumesDrag)) world.insert(entity, UIConsumesDrag);
            const refs = JSON.stringify([data.fields, data.hex, data.rememberButton, data.historyRoot]);
            if (state && state.refs !== refs) { destroy(root); state = undefined; }
            const initial = !state;
            if (!state) {
                const color = normalizePickerColor(data.color, data.alphaEnabled);
                state = { color, hsv: col.toHsv(color), alpha: color.a, refs, format: data.format, history: '', swatches: [], off: [], swatchOff: [], editingHSV: false };
                states.set(root, state);
                const edit = (field: Entity, index: number): void => {
                    if (!playing() || !available(root) || !child(root, field, TextInput)) return;
                    const current = world.get(root, UIColorPicker), text = world.get(field, TextInput).value, s = states.get(root)!;
                    if (index === 4) {
                        try { setColor(root, col.fromHex(text)); } catch { /* Incomplete text remains editable until blur. */ }
                    } else {
                        if (!text.trim()) return;
                        const n = Number(text); if (!Number.isFinite(n)) return;
                        if (index === 3) setColor(root, { ...current.color, a: n / 100 });
                        else if (current.format === 1) setColor(root, { ...current.color, [(['r', 'g', 'b'] as const)[index]]: n / 255 });
                        else {
                            const hsv = { ...s.hsv, [(['h', 's', 'v'] as const)[index]]: index === 0 ? n : n / 100 };
                            hsv.h = ((hsv.h % 360) + 360) % 360;
                            hsv.s = Math.max(0, Math.min(1, hsv.s)); hsv.v = Math.max(0, Math.min(1, hsv.v));
                            s.hsv = hsv; s.editingHSV = true; setColor(root, col.fromHsv(hsv.h, hsv.s, hsv.v, current.color.a));
                        }
                    }
                };
                const inputs = [...data.fields.slice(0, 4).map((field, index) => ({ field, index })), { field: data.hex, index: 4 }];
                for (const { index, field } of inputs) if (child(root, field, TextInput)) {
                    state.off.push(events.on(field, UIEventType.Change, () => edit(field, index)), events.on(field, UIEventType.Submit, () => edit(field, index)));
                }
                if (world.valid(data.rememberButton)) state.off.push(events.on(data.rememberButton, UIEventType.Click, () => {
                    if (!playing() || !available(root)) return;
                    const d = world.get(root, UIColorPicker); if (!d.rememberColors) return;
                    const limit = Math.max(0, Math.min(32, Math.floor(d.historyLimit) || 0));
                    const color = normalizePickerColor(d.color, d.alphaEnabled);
                    const history = [color, ...d.history.filter(item => !col.equals(normalizePickerColor(item), color))].slice(0, limit);
                    world.insert(root, UIColorPicker, { ...d, history }); events.emit(root, 'history_change', { colors: history.map(c => ({ ...c })) });
                }));
            }
            const previous = { ...state.color };
            let color = normalizePickerColor(data.color, data.alphaEnabled);
            const external = !col.equals(color, state.color);
            if (external && !state.editingHSV) { state.hsv = col.toHsv(color, state.hsv.h); state.alpha = color.a; }
            const enabled = playing() && available(root);
            if (enabled && !external && !initial && !state.editingHSV) {
                const hue = child(root, data.hue, UISlider) ? world.get(data.hue, UISlider).value : state.hsv.h;
                const a = child(root, data.alpha, UISlider) && data.alphaEnabled ? world.get(data.alpha, UISlider).value : color.a;
                if (hue !== state.hsv.h || a !== state.alpha) { state.hsv.h = hue; state.alpha = a; color = col.fromHsv(hue, state.hsv.s, state.hsv.v, a); }
            }
            if (enabled && !cancelled && child(root, data.sv, UINode)) {
                for (const pointer of pointers.values()) if (pointer.down && pointer.entity === data.sv) {
                    const screen = isScreenEntity(world, data.sv);
                    const point = local.point(data.sv, screen ? pointer.layoutX : pointer.worldX, screen ? pointer.layoutY : pointer.worldY);
                    const width = engine?.getUINodeComputedWidth?.(registry!, data.sv) ?? 0, height = engine?.getUINodeComputedHeight?.(registry!, data.sv) ?? 0;
                    if (point && width > 0 && height > 0) {
                        state.hsv.s = Math.max(0, Math.min(1, point.x / width + .5)); state.hsv.v = Math.max(0, Math.min(1, point.y / height + .5));
                        color = col.fromHsv(state.hsv.h, state.hsv.s, state.hsv.v, color.a);
                    }
                }
                if (focus.focusedEntity === data.sv && isFocusEligible(world, data.sv)) {
                    const step = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight') ? .1 : .01;
                    if (input.isKeyPressed('ArrowLeft')) state.hsv.s -= step; if (input.isKeyPressed('ArrowRight')) state.hsv.s += step;
                    if (input.isKeyPressed('ArrowDown')) state.hsv.v -= step; if (input.isKeyPressed('ArrowUp')) state.hsv.v += step;
                    state.hsv.s = Math.max(0, Math.min(1, state.hsv.s)); state.hsv.v = Math.max(0, Math.min(1, state.hsv.v));
                    color = col.fromHsv(state.hsv.h, state.hsv.s, state.hsv.v, color.a);
                }
            }
            color = normalizePickerColor(color, data.alphaEnabled); state.color = { ...color }; state.alpha = color.a;
            state.editingHSV = false;
            if (!col.equals(data.color, color)) { world.insert(root, UIColorPicker, { ...data, color }); data = world.get(root, UIColorPicker); }
            if (child(root, data.hue, UISlider) && world.get(data.hue, UISlider).value !== state.hsv.h) world.update(data.hue, UISlider, draft => { draft.value = state!.hsv.h; });
            if (child(root, data.alpha, UISlider) && world.get(data.alpha, UISlider).value !== color.a) world.update(data.alpha, UISlider, draft => { draft.value = color.a; });
            const alphaDisplay = data.alphaEnabled ? UIDisplay.Flex : UIDisplay.None;
            if (child(root, data.alpha, UINode) && world.get(data.alpha, UINode).display !== alphaDisplay) world.update(data.alpha, UINode, draft => { draft.display = alphaDisplay; });
            if (owner && !state.plane) {
                const pixels = new Uint8Array(64 * 64 * 4); paintPlane(pixels, state.hsv.h);
                // Canvas content means its owner repaints after loss, without
                // requiring a DOM canvas or changing the engine texture handle.
                const handle = createTextureFromPixels(app.wasmModule, { width: 64, height: 64, pixels }, TextureContent.Canvas, false,
                    { filterMode: 'linear', wrapMode: 'clamp' }, owner);
                const current = state;
                const refill = (): boolean => {
                    if (states.get(root) !== current || !owner) return false;
                    updateTextureSubregion(app.wasmModule, handle, 0, 0, 64, 64, pixels, owner); return true;
                };
                state.plane = { handle, pixels, hue: state.hsv.h, refill }; provideTextureContent(handle, refill);
            }
            if (state.plane) {
                if (Math.abs(state.plane.hue - state.hsv.h) > .0001) {
                    state.plane.hue = state.hsv.h; paintPlane(state.plane.pixels, state.hsv.h);
                    updateTextureSubregion(app.wasmModule, state.plane.handle, 0, 0, 64, 64, state.plane.pixels, owner!);
                }
                image(root, data.sv, state.plane.handle, undefined, { x: .5 / 64, y: .5 / 64 }, { x: 63 / 64, y: 63 / 64 });
            } else {
                const hueColor = col.fromHsv(state.hsv.h, 1, 1);
                if (child(root, data.sv, UIVisual) && !col.equals(world.get(data.sv, UIVisual).color, hueColor)) world.update(data.sv, UIVisual, visual => { visual.color = hueColor; });
            }
            if (child(root, data.cursor, UINode)) {
                const node = world.get(data.cursor, UINode), left = state.hsv.s * 100, top = (1 - state.hsv.v) * 100;
                if (Math.abs(node.insetLeft.value - left) > .001 || Math.abs(node.insetTop.value - top) > .001) world.update(data.cursor, UINode, n => { n.insetLeft = percent(left); n.insetTop = percent(top); });
            }
            if (child(root, data.preview, UIVisual) && !col.equals(world.get(data.preview, UIVisual).color, color)) world.update(data.preview, UIVisual, visual => { visual.color = color; });
            if (ramps.length) {
                image(root, data.hue, ramps[1], undefined, { x: .5 / 361, y: 0 }, { x: 360 / 361, y: 1 });
                image(root, data.alpha, ramps[2], undefined, undefined, undefined, true);
                // Reverse the shared white ramp for a transparent-to-opaque alpha bar.
                image(root, data.alphaRamp, ramps[0], { ...color, a: 1 }, { x: .75, y: 0 }, { x: -.5, y: 1 });
                for (const entity of [data.hue, data.alpha]) if (child(root, entity, UISlider)) {
                    const slider = world.get(entity, UISlider);
                    if (child(root, slider.fill, UIVisual) && world.get(slider.fill, UIVisual).enabled) world.update(slider.fill, UIVisual, visual => { visual.enabled = false; });
                }
            }
            const values = data.format === 1 ? [color.r * 255, color.g * 255, color.b * 255, color.a * 100]
                : [state.hsv.h, state.hsv.s * 100, state.hsv.v * 100, color.a * 100];
            const inputs = [...data.fields.slice(0, 4).map((field, index) => ({ field, index })), { field: data.hex, index: 4 }];
            for (const { index, field } of inputs) if (child(root, field, TextInput) && focus.focusedEntity !== field) {
                const value = index === 4 ? col.toHex(color, true) : String(Math.round(values[index]));
                if (world.get(field, TextInput).value !== value) world.update(field, TextInput, text => { text.value = value; text.cursorPos = Math.min(text.cursorPos, value.length); });
            }
            if (state.format !== data.format || initial) {
                const labels = data.format === 1 ? ['R', 'G', 'B', 'A %'] : ['H °', 'S %', 'V %', 'A %'];
                if (world.has(root, Children)) for (const entity of world.get(root, Children).entities) if (world.has(entity, Name) && world.has(entity, Text)) {
                    const match = /^ColorChannelLabel([0-3])$/.exec(world.get(entity, Name).value);
                    if (match) world.update(entity, Text, text => { text.content = labels[Number(match[1])]; });
                }
                state.format = data.format;
            }
            const history = JSON.stringify([data.history, data.historyLimit, data.rememberColors]);
            if (state.history !== history) {
                state.history = history; state.swatchOff.forEach(off => off()); state.swatchOff = [];
                state.swatches.forEach(e => { if (world.valid(e)) world.despawn(e); }); state.swatches = [];
                const colors = data.history.slice(0, Math.max(0, Math.min(32, Math.floor(data.historyLimit) || 0)));
                if (child(root, data.rememberButton, UINode)) world.update(data.rememberButton, UINode, draft => { draft.display = data.rememberColors ? UIDisplay.Flex : UIDisplay.None; });
                if (child(root, data.historyRoot, UINode) && data.rememberColors) colors.forEach((value, index) => {
                    const swatch = spawnUIEntity({ world, parent: data.historyRoot,
                        node: { position: 1, width: px(22), height: px(22), insetLeft: px((index % 8) * 29), insetTop: px(Math.floor(index / 8) * 29) }, visual: { color: normalizePickerColor(value) } });
                    makeWidgetInteractable(world, swatch); state!.swatches.push(swatch);
                    state!.swatchOff.push(events.on(swatch, UIEventType.Click, () => { if (playing() && available(root)) setColor(root, value); }));
                });
            }
            if (!initial && !col.equals(previous, color)) events.emit(root, UIEventType.Change, { color: { ...color } });
        }
    }, { name: 'UIColorPickerSystem', runAfter: ['UISliderSystem', 'FocusSystem'] }));
    const offDespawn = world.onDespawn(entity => destroy(entity));
    return () => { offDespawn(); for (const entity of [...states.keys()]) destroy(entity); local.dispose(); ramps.forEach(handle => owner?.releaseTexture(handle)); ramps = []; };
}
