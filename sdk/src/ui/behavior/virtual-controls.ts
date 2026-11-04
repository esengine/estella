// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineComponent, Transform } from '../../ecs/component';
import { defineSystem } from '../../ecs/system';
import { Res, Time, type TimeData } from '../../ecs/resource';
import { SystemLabel } from '../../ecs/systemLabels';
import { Input, type InputState } from '../../input/input';
import type { World } from '../../ecs/world';
import type { Entity, Vec2 } from '../../types';
import { worldEngineApi } from '../../ecs/bridge/engineApi';
import { UINode } from '../core/ui-node';
import { px, DimensionUnit } from '../core/dimension';
import { UIEventType, type UIEventQueue } from '../core/events';
import { Interactable } from '../input/interactable';
import { UIControlPointers, type ControlPointer } from '../input/control-pointers';
import { isScreenEntity } from '../util/ui-pick';
import { isPointerBlockedInTree } from '../util/helpers';
import { createLiveVisibilityQuery } from '../util/live-visibility';
import { createLocalTransformReader } from '../util/local-transform';

export enum VirtualJoystickMode { Fixed = 0, Follow = 1 }
export interface VirtualJoystickData {
    inputId: string;
    mode: VirtualJoystickMode;
    radius: number;
    deadZone: number;
    returnSpeed: number;
    base: Entity;
    handle: Entity;
}
export interface VirtualButtonData { inputId: string; value: number }
export const VirtualJoystick = defineComponent<VirtualJoystickData>('VirtualJoystick', {
    inputId: 'move', mode: VirtualJoystickMode.Fixed, radius: 50, deadZone: 0.15,
    returnSpeed: 18, base: 0 as Entity, handle: 0 as Entity,
}, { entityFields: ['base', 'handle'], fields: {
    mode: { enum: [{ label: 'Fixed', value: VirtualJoystickMode.Fixed }, { label: 'Follow', value: VirtualJoystickMode.Follow }] },
    radius: { min: 1, unit: 'px' }, deadZone: { min: 0, max: 0.99, slider: true },
    returnSpeed: { min: 0 }, base: { advanced: true }, handle: { advanced: true },
} });
export const VirtualButton = defineComponent<VirtualButtonData>('VirtualButton', { inputId: 'fire', value: 1 });

/** A radial dead zone preserves direction and reaches one at the rim. */
export function joystickAxis(x: number, y: number, radius: number, deadZone: number): Vec2 {
    const length = Math.hypot(x, y);
    const r = Number.isFinite(radius) ? Math.max(1, radius) : 50;
    const dead = Number.isFinite(deadZone) ? Math.max(0, Math.min(0.99, deadZone)) : 0.15;
    if (!Number.isFinite(length) || length <= r * dead) return { x: 0, y: 0 };
    const strength = Math.min(1, (length / r - dead) / (1 - dead));
    return { x: x / length * strength, y: y / length * strength };
}
interface ControlState {
    owner: object;
    pointer: number | null;
    buttons: Set<number>;
    origin: Vec2;
    thumb: Vec2;
    value: Vec2;
}
interface PointerGroup { held: ControlPointer[]; tapped: boolean }
const NO_HELD_POINTERS: readonly ControlPointer[] = [];
export function createVirtualControlSystem(world: World, events: UIEventQueue) {
    const states = new Map<Entity, ControlState>();
    const engine = worldEngineApi(world); const registry = world.getCppRegistry();
    const localTransform = createLocalTransformReader(world);
    let input: InputState | null = null;
    const release = (entity: Entity) => {
        const state = states.get(entity); if (!state) return;
        input?.removeVirtualSource(state.owner); states.delete(entity);
    };
    const offDespawn = world.onDespawn(release);
    const hiddenFallback = (entity: Entity) => !!engine?.getUINodeHiddenInTree?.(registry!, entity);
    const enabled = (entity: Entity, hidden: (entity: Entity) => boolean) => {
        if (!world.valid(entity) || !world.isEntityActive(entity) || world.isDestructionPending(entity)
            || (world.has(entity, Interactable) && !world.get(entity, Interactable).enabled)
            || hidden(entity)) return false;
        return !isPointerBlockedInTree(world, entity);
    };
    const getState = (entity: Entity): ControlState => {
        let state = states.get(entity);
        if (!state) { state = { owner: {}, pointer: null, buttons: new Set(), origin: { x: 0, y: 0 },
            thumb: { x: 0, y: 0 }, value: { x: 0, y: 0 } }; states.set(entity, state); }
        return state;
    };
    const point = (entity: Entity, pointer: ControlPointer): Vec2 | null => {
        const screen = isScreenEntity(world, entity);
        const px = screen ? pointer.layoutX : pointer.worldX, py = screen ? pointer.layoutY : pointer.worldY;
        const resolved = localTransform.point(entity, px, py);
        if (resolved !== undefined) return resolved;
        const t = world.get(entity, Transform);
        if (!t.worldScale.x || !t.worldScale.y) return null;
        const x = px - t.worldPosition.x, y = py - t.worldPosition.y;
        const q = t.worldRotation;
        const angle = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
        const local = { x: (x * Math.cos(angle) + y * Math.sin(angle)) / t.worldScale.x,
            y: (-x * Math.sin(angle) + y * Math.cos(angle)) / t.worldScale.y };
        return Number.isFinite(local.x) && Number.isFinite(local.y) ? local : null;
    };
    const positionChild = (entity: Entity, child: Entity, offset: Vec2) => {
        if (!world.valid(child) || !world.has(child, UINode)) return;
        const width = engine?.getUINodeComputedWidth?.(registry!, entity) ?? 0;
        const height = engine?.getUINodeComputedHeight?.(registry!, entity) ?? 0;
        const node = world.get(child, UINode);
        const x = width / 2 + offset.x;
        const y = height / 2 - offset.y;
        if (node.insetLeft.unit === DimensionUnit.Px && node.insetTop.unit === DimensionUnit.Px
            && node.insetLeft.value === x && node.insetTop.value === y) return;
        world.insert(child, UINode, { ...node, insetLeft: px(x), insetTop: px(y) });
    };
    return {
        system: defineSystem([Res(Input), Res(UIControlPointers), Res(Time)],
            (current: InputState, frame: { pointers: Map<number, ControlPointer> }, time: TimeData) => {
                input = current;
                let hidden = createLiveVisibilityQuery(world, hiddenFallback);
                let groups: Map<Entity, PointerGroup> | null = null;
                const pointersFor = (entity: Entity): PointerGroup | undefined => {
                    if (!groups) {
                        groups = new Map();
                        for (const pointer of frame.pointers.values()) {
                            const target = pointer.down ? pointer.entity : pointer.pressed ? pointer.pressedEntity : null;
                            if (target === null) continue;
                            let group = groups.get(target);
                            if (!group) { group = { held: [], tapped: false }; groups.set(target, group); }
                            if (pointer.down) group.held.push(pointer);
                            else group.tapped = true;
                        }
                    }
                    return groups.get(entity);
                };
                for (const entity of states.keys()) if (!world.valid(entity)
                    || (!world.has(entity, VirtualJoystick) && !world.has(entity, VirtualButton))) release(entity);
                for (const type of [VirtualJoystick, VirtualButton] as const) {
                    for (const entity of world.getEntitiesWithComponents([type])) {
                        if (!world.has(entity, Transform)) { release(entity); continue; }
                        const state = getState(entity);
                        const available = enabled(entity, hidden);
                        const group = available ? pointersFor(entity) : undefined;
                        const held = group?.held ?? NO_HELD_POINTERS;
                        let value: Vec2 = { x: 0, y: 0 };
                        let id: string;
                        if (type === VirtualJoystick) {
                            const data = world.get(entity, VirtualJoystick);
                            id = data.inputId;
                            let pointer = held.find(p => p.id === state.pointer);
                            let fresh = false;
                            if (!pointer) {
                                state.pointer = null;
                                pointer = held.find(p => p.pressed);
                                fresh = !!pointer;
                            }
                            const local = pointer ? point(entity, pointer) : null;
                            if (pointer && local) {
                                if (fresh) {
                                    state.pointer = pointer.id;
                                    state.origin = data.mode === VirtualJoystickMode.Follow ? local : { x: 0, y: 0 };
                                }
                                const dx = local.x - state.origin.x, dy = local.y - state.origin.y;
                                value = joystickAxis(dx, dy, data.radius, data.deadZone);
                                const ratio = Math.min(1, Math.max(1, data.radius) / (Math.hypot(dx, dy) || 1));
                                state.thumb = { x: dx * ratio, y: dy * ratio };
                            } else {
                                state.pointer = null;
                                const spring = Math.exp(-Math.max(0, data.returnSpeed) * Math.max(0, time.delta));
                                state.thumb = { x: state.thumb.x * spring, y: state.thumb.y * spring };
                                if (Math.hypot(state.thumb.x, state.thumb.y) < 0.1 || data.returnSpeed <= 0) {
                                    state.thumb = { x: 0, y: 0 }; state.origin = { x: 0, y: 0 };
                                }
                            }
                            positionChild(entity, data.base, state.origin);
                            positionChild(entity, data.handle, { x: state.origin.x + state.thumb.x, y: state.origin.y + state.thumb.y });
                        } else {
                            const data = world.get(entity, VirtualButton); id = data.inputId;
                            for (const pointer of state.buttons) if (!held.some(p => p.id === pointer)) state.buttons.delete(pointer);
                            for (const pointer of held) if (pointer.pressed) state.buttons.add(pointer.id);
                            const tapped = group?.tapped;
                            if (state.buttons.size || tapped) value.x = data.value;
                        }
                        current.setVirtualSource(state.owner, id, value.x, value.y);
                        if (value.x !== state.value.x || value.y !== state.value.y) {
                            state.value = value;
                            events.emit(entity, UIEventType.Change, { value: { ...value } });
                            hidden = createLiveVisibilityQuery(world, hiddenFallback);
                            groups = null;
                        }
                    }
                }
            }, { name: SystemLabel.VirtualControls }),
        dispose: () => { offDespawn(); for (const entity of states.keys()) release(entity); localTransform.dispose(); },
    };
}
