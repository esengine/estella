// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent } from '../../ecs/component';
import { defineSystem } from '../../ecs/system';
import { Res, Time, type TimeData } from '../../ecs/resource';
import { Input, type InputState } from '../../input/input';
import { primaryPointerCancellationVersion } from '../../input/pointerCancellation';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import type { InstantiatePrefabResult } from '../../prefab';
import { UINode, UIPointerEvents, UIDisplay } from '../core/ui-node';
import { Text } from '../core/text';
import { spawnUIEntity } from '../core/compose';
import { px } from '../core/dimension';
import { ScreenLayout, type ScreenLayoutData } from '../core/screen-layout';
import { ScreenOverlay, type ScreenOverlayData } from '../core/screen-overlay';
import { UICameraInfo, type UICameraData } from '../core/ui-camera-info';
import { UIControlPointers, type ControlPointer } from '../input/control-pointers';
import { MOUSE_POINTER } from '../input/pointerBook';
import { Focusable, type FocusManagerState, FocusManager } from '../input/focusable';
import { Interactable, UIInteraction } from '../input/interactable';
import { createLiveVisibilityQuery } from '../util/live-visibility';
import { isFocusEligible } from '../input/focus-inspection';
import { createPopupBoundsReader, createPopupCanvas, type PopupBounds } from '../util/popup-anchor';
import { themeColors } from '../theme/tokens';
import { markThemed } from '../theme/theme-style';
import { measureText } from '../text/measure-text';

/** Trigger and layout settings for an engine UI tooltip. @beta */
export interface UITooltipData {
    content: string;
    stylePrefab: string;
    hover: boolean;
    focus: boolean;
    longPress: boolean;
    hoverDelay: number;
    longPressDelay: number;
    /** 0 bottom, 1 top, 2 left, 3 right. */
    side: number;
    gap: number;
    avoidEdges: boolean;
    maxWidth: number;
}

/** An input-transparent, themed engine UI popup attached to a target. @beta */
export const UITooltip = defineComponent<UITooltipData>('UITooltip', {
    content: 'Tooltip', stylePrefab: '', hover: true, focus: true, longPress: true,
    hoverDelay: 0.5, longPressDelay: 0.6, side: 0, gap: 8, avoidEdges: true, maxWidth: 240,
}, { assetFields: [{ field: 'stylePrefab', type: 'prefab' }], fields: {
    hoverDelay: { min: 0, unit: 's' }, longPressDelay: { min: 0, unit: 's' },
    gap: { min: 0, unit: 'px' }, maxWidth: { min: 24, unit: 'px' },
    side: { enum: [{ label: 'Bottom', value: 0 }, { label: 'Top', value: 1 }, { label: 'Left', value: 2 }, { label: 'Right', value: 3 }] },
} });

/** Layout-domain placement. Flip first, then clamp; oversized bubbles stay inside the safe box. */
export function placeTooltip(target: PopupBounds, width: number, height: number, side: number, gap: number,
    bounds: PopupBounds, avoidEdges: boolean): { x: number; y: number } {
    const position = (s: number) => ({
        x: s === 2 ? target.left - gap - width : s === 3 ? target.right + gap : (target.left + target.right - width) / 2,
        y: s === 1 ? target.top + gap : s === 0 ? target.bottom - gap - height : (target.top + target.bottom - height) / 2,
    });
    let p = position(side);
    const fits = (v: typeof p) => v.x >= bounds.left && v.x + width <= bounds.right
        && v.y >= bounds.bottom && v.y + height <= bounds.top;
    if (avoidEdges) {
        if (!fits(p)) {
            const flipped = position(side ^ 1);
            if (fits(flipped)) p = flipped;
        }
        p.x = Math.max(bounds.left, Math.min(p.x, bounds.right - width));
        p.y = Math.max(bounds.bottom, Math.min(p.y, bounds.top - height));
    }
    return p;
}

interface TooltipState {
    elapsed: number;
    trigger: 'hover' | 'focus' | 'touch' | null;
    pointer: number;
    startX: number;
    startY: number;
    moved: boolean;
    overlay?: Entity;
    popup?: Entity;
    label?: Entity;
    signature?: string;
    pending?: object;
}

export interface TooltipPrefabHost {
    instantiate(ref: string, parent: Entity): Promise<InstantiatePrefabResult>;
}
const previews = new WeakMap<World, Set<Entity>>();
/** Ephemeral authoring preview; never changes scene data or authored delays. @experimental */
export function previewTooltip(world: World, target: Entity): () => void {
    let set = previews.get(world);
    if (!set) { set = new Set(); previews.set(world, set); }
    set.add(target);
    return () => { set.delete(target); };
}

/** Owns all transient entities, asynchronous loads and matrix memory for one App. */
export function createTooltipSystem(world: World, prefabHost?: TooltipPrefabHost, isPlaying = () => true) {
    const states = new Map<Entity, TooltipState>();
    const bounds = createPopupBoundsReader(world);
    let disposed = false, cancellation = -1;
    let touchBlocksHover = false, touchMouseX = 0, touchMouseY = 0;
    const close = (s: TooltipState) => {
        s.pending = undefined;
        if (s.overlay !== undefined && world.valid(s.overlay)) world.despawn(s.overlay);
        s.overlay = s.popup = s.label = undefined; s.signature = undefined;
    };
    const offDespawn = world.onDespawn(e => {
        const s = states.get(e);
        if (s) { states.delete(e); close(s); }
        previews.get(world)?.delete(e);
    });
    const reset = () => { for (const s of states.values()) close(s); states.clear(); };
    const dispose = () => {
        disposed = true; offDespawn(); reset();
        bounds.dispose();
    };
    const system = defineSystem([Res(Input), Res(Time), Res(ScreenLayout), Res(ScreenOverlay),
        Res(UICameraInfo), Res(UIControlPointers), Res(FocusManager)],
    (input: InputState, time: TimeData, layout: ScreenLayoutData, overlay: ScreenOverlayData,
        camera: UICameraData, pointers: { pointers: Map<number, ControlPointer> }, focus: FocusManagerState) => {
        if (disposed) return;
        const version = primaryPointerCancellationVersion(input);
        const cancelled = cancellation !== -1 && version !== cancellation;
        cancellation = version;
        const mousePointer = pointers.pointers.get(MOUSE_POINTER);
        if (input.touches.size || input.touchesEnded.size || [...pointers.pointers.values()].some(p => p.id !== MOUSE_POINTER && p.down)) {
            touchBlocksHover = true; touchMouseX = input.mouseX; touchMouseY = input.mouseY;
        } else if (input.mouseX !== touchMouseX || input.mouseY !== touchMouseY || mousePointer?.pressed) {
            // The host may leave its synthesized mouse over the lifted finger.
            // Resume hover only on fresh mouse activity, never from that stale position.
            touchBlocksHover = false;
        }
        const hidden = createLiveVisibilityQuery(world, () => false);
        const live = new Set(world.getEntitiesWithComponents([UITooltip, UINode]));
        for (const [e, s] of states) if (!live.has(e)) { close(s); states.delete(e); }
        for (const e of live) {
            let s = states.get(e);
            if (!s) { s = { elapsed: 0, trigger: null, pointer: -2, startX: 0, startY: 0, moved: false }; states.set(e, s); }
            const d = world.get(e, UITooltip);
            const preview = !isPlaying() && !!previews.get(world)?.has(e);
            const available = layout.valid && overlay.active && !hidden(e) && world.isEntityActive(e)
                && !world.isDestructionPending(e) && (!world.has(e, Interactable) || world.get(e, Interactable).enabled);
            const touch = [...pointers.pointers.values()].find(p => p.id !== MOUSE_POINTER && p.down && p.entity === e);
            const mouse = pointers.pointers.get(MOUSE_POINTER);
            const hovered = world.has(e, UIInteraction) && world.get(e, UIInteraction).hovered;
            let trigger: TooltipState['trigger'] = null;
            if (cancelled && touch) { s.moved = true; s.pointer = touch.id; }
            if (available && d.content && preview) trigger = 'focus';
            else if (isPlaying() && available && d.content && !cancelled && !input.isKeyPressed('Escape')) {
                if (touch && d.longPress) {
                    if (s.pointer !== touch.id) {
                        s.pointer = touch.id; s.startX = touch.layoutX; s.startY = touch.layoutY; s.moved = false;
                    }
                    if (Math.hypot(touch.layoutX - s.startX, touch.layoutY - s.startY) * layout.scale > 8) s.moved = true;
                    if (!s.moved && touch.entity === e) trigger = 'touch';
                } else if (d.focus && focus.isVisiblyFocused(e) && isFocusEligible(world, e)) trigger = 'focus';
                else if (d.hover && hovered && mouse?.down === false && !touchBlocksHover) trigger = 'hover';
            }
            if (!touch) { s.pointer = -2; s.moved = false; }
            if (trigger !== s.trigger) { close(s); s.elapsed = 0; s.trigger = trigger; }
            if (!trigger) continue;
            s.elapsed += Number.isFinite(time.delta) ? Math.max(0, time.delta) : 0;
            const delay = trigger === 'focus' ? 0 : trigger === 'touch' ? d.longPressDelay : d.hoverDelay;
            if (s.elapsed < (Number.isFinite(delay) ? Math.max(0, delay) : 0)) continue;
            const target = bounds.read(e, camera, overlay);
            if (!target) { close(s); continue; }
            const signature = JSON.stringify([d.content, d.stylePrefab]);
            if (s.signature !== signature) { close(s); s.signature = signature; }
            if (s.overlay === undefined) {
                const canvas = createPopupCanvas(world, e, UIPointerEvents.None);
                s.overlay = canvas;
                if (d.stylePrefab && prefabHost) {
                    const token = {}; s.pending = token;
                    const state = s;
                    void prefabHost.instantiate(d.stylePrefab, canvas).then(result => {
                        if (disposed || state.pending !== token || !world.valid(canvas)) {
                            for (const id of result.entities.values()) if (world.valid(id)) world.despawn(id);
                            return;
                        }
                        state.pending = undefined;
                        if (!world.has(result.root, UINode)) throw new Error('Tooltip style needs a UINode root');
                        state.popup = result.root;
                        state.label = [...result.entities.values()].find(id => id !== result.root && world.has(id, Text) && world.has(id, UINode));
                        if (state.label === undefined) throw new Error('Tooltip style needs a Text node');
                        for (const id of result.entities.values()) {
                            if (world.has(id, Focusable)) world.remove(id, Focusable);
                            if (world.has(id, Interactable)) world.remove(id, Interactable);
                        }
                    }).catch(error => {
                        if (state.overlay !== canvas || disposed) return;
                        state.pending = undefined;
                        if (state.popup !== undefined && world.valid(state.popup)) world.despawn(state.popup);
                        state.popup = state.label = undefined;
                        console.warn('[UITooltip] Could not display style prefab:', error);
                    });
                } else {
                    const c = themeColors(world);
                    s.popup = spawnUIEntity({ world, parent: canvas, node: { position: 1 }, visual: { color: c.surfaceElevated } });
                    markThemed(world, s.popup, { visual: 'surfaceElevated' });
                    s.label = spawnUIEntity({ world, parent: s.popup, node: { fill: true },
                        text: { content: d.content, color: c.text, fontSize: 14, wordWrap: true } });
                    markThemed(world, s.label, { text: 'text' });
                }
            }
            if (s.popup === undefined || s.label === undefined || !world.valid(s.popup) || !world.valid(s.label)) continue;
            const text = world.get(s.label, Text);
            const availableWidth = Math.max(1, layout.safeRight - layout.safeLeft);
            const maxWidth = Math.max(1, Math.min(Number.isFinite(d.maxWidth) ? Math.max(24, d.maxWidth) : 240, availableWidth - 20));
            const measured = measureText(d.content, { ...text, maxWidth,
                lineHeight: text.fontSize * text.lineHeight });
            const width = Math.min(availableWidth, measured.width + 20);
            const height = Math.min(Math.max(24, measured.height + 16), layout.safeTop - layout.safeBottom);
            const p = placeTooltip(target, width, height, Number.isInteger(d.side) && d.side >= 0 && d.side <= 3 ? d.side : 0,
                Number.isFinite(d.gap) ? Math.max(0, d.gap) : 8,
                { left: layout.safeLeft, right: layout.safeRight, bottom: layout.safeBottom, top: layout.safeTop }, d.avoidEdges);
            const node = world.get(s.popup, UINode);
            const left = p.x - layout.left, top = layout.top - p.y - height;
            const same = (dim: { value: number; unit: number }, n: number) => dim.unit === 0 && Math.abs(dim.value - n) < 0.01;
            if (node.position !== 1 || node.display !== UIDisplay.Flex || node.pointerEvents !== UIPointerEvents.None
                || !same(node.width, width) || !same(node.height, height) || !same(node.insetLeft, left) || !same(node.insetTop, top)) {
                world.insert(s.popup, UINode, { ...node, position: 1, display: UIDisplay.Flex, pointerEvents: UIPointerEvents.None,
                    width: px(width), height: px(height), insetLeft: px(left), insetTop: px(top) });
            }
            if (text.content !== d.content || !text.wordWrap) world.insert(s.label, Text, { ...text, content: d.content, wordWrap: true });
            const labelNode = world.get(s.label, UINode);
            if (labelNode.position !== 1 || labelNode.insetLeft.value !== 10 || labelNode.insetRight.value !== 10
                || labelNode.insetTop.value !== 8 || labelNode.insetBottom.value !== 8) {
                world.insert(s.label, UINode, { ...labelNode, position: 1, insetLeft: px(10), insetRight: px(10), insetTop: px(8), insetBottom: px(8) });
            }
        }
    }, { name: 'UITooltipSystem', runAfter: ['UITabViewSystem', 'FocusSystem'] });
    return { system, dispose, reset };
}
