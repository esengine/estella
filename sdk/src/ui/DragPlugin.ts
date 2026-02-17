import type { App, Plugin } from '../app';
import { registerComponent, LocalTransform, WorldTransform, Parent } from '../component';
import type { LocalTransformData, WorldTransformData, ParentData } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res } from '../resource';
import { Input } from '../input';
import type { InputState } from '../input';
import type { Entity } from '../types';
import type { World } from '../world';
import { Draggable, DragState } from './Draggable';
import type { DraggableData, DragStateData } from './Draggable';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { UIEvents, UIEventQueue } from './UIEvents';
import { UICameraInfo } from './UICameraInfo';
import type { UICameraData } from './UICameraInfo';
import { invertMatrix4, screenToWorld } from './uiMath';

const _dragInvVP = new Float32Array(16);
const _dragCachedVP = new Float32Array(16);
let _dragInvVPDirty = true;

function updateDragInvVPCache(vp: Float32Array): void {
    let dirty = false;
    for (let i = 0; i < 16; i++) {
        if (_dragCachedVP[i] !== vp[i]) {
            dirty = true;
            break;
        }
    }
    if (dirty) {
        _dragCachedVP.set(vp);
        _dragInvVPDirty = true;
    }
}

function getWorldMousePos(input: InputState, camera: UICameraData, dpr: number): { x: number; y: number } {
    const mouseGLX = input.mouseX * dpr;
    const mouseGLY = camera.screenH - input.mouseY * dpr;

    updateDragInvVPCache(camera.viewProjection);
    if (_dragInvVPDirty) {
        invertMatrix4(camera.viewProjection, _dragInvVP);
        _dragInvVPDirty = false;
    }

    return screenToWorld(
        mouseGLX, mouseGLY, _dragInvVP,
        camera.vpX, camera.vpY, camera.vpW, camera.vpH,
    );
}

function worldToLocalDelta(
    world: World,
    entity: Entity,
    dx: number,
    dy: number
): { x: number; y: number } {
    if (!world.has(entity, Parent)) {
        return { x: dx, y: dy };
    }
    const parentData = world.get(entity, Parent) as ParentData;
    const parentEntity = parentData.entity;
    if (!world.valid(parentEntity) || !world.has(parentEntity, WorldTransform)) {
        return { x: dx, y: dy };
    }
    const parentWt = world.get(parentEntity, WorldTransform) as WorldTransformData;
    const sx = parentWt.scale.x !== 0 ? parentWt.scale.x : 1;
    const sy = parentWt.scale.y !== 0 ? parentWt.scale.y : 1;

    const angle = 2 * Math.atan2(parentWt.rotation.z, parentWt.rotation.w);
    const sin = Math.sin(-angle);
    const cos = Math.cos(-angle);

    return {
        x: (dx * cos - dy * sin) / sx,
        y: (dx * sin + dy * cos) / sy,
    };
}

function applyConstraints(
    draggable: DraggableData,
    dragState: DragStateData,
    newX: number,
    newY: number
): { x: number; y: number } {
    let x = draggable.lockX ? dragState.startWorldPos.x : newX;
    let y = draggable.lockY ? dragState.startWorldPos.y : newY;

    if (draggable.constraintMin !== null) {
        x = Math.max(x, draggable.constraintMin.x);
        y = Math.max(y, draggable.constraintMin.y);
    }
    if (draggable.constraintMax !== null) {
        x = Math.min(x, draggable.constraintMax.x);
        y = Math.min(y, draggable.constraintMax.y);
    }

    return { x, y };
}

export class DragPlugin implements Plugin {
    build(app: App): void {
        registerComponent('Draggable', Draggable);
        registerComponent('DragState', DragState);

        const world = app.world;
        const events = app.getResource(UIEvents) as UIEventQueue;

        let pendingEntity: Entity | null = null;
        let pendingStartWorld = { x: 0, y: 0 };
        let activeEntity: Entity | null = null;
        const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

        app.addSystemToSchedule(Schedule.PreUpdate, defineSystem(
            [Res(Input), Res(UICameraInfo)],
            (input: InputState, camera: UICameraData) => {
                if (!camera.valid) return;

                const worldMouse = getWorldMousePos(input, camera, dpr);

                if (input.isMouseButtonPressed(0)) {
                    const draggableEntities = world.getEntitiesWithComponents([Draggable, UIInteraction]);
                    let bestEntity: Entity | null = null;

                    for (const entity of draggableEntities) {
                        const draggable = world.get(entity, Draggable) as DraggableData;
                        if (!draggable.enabled) continue;
                        const interaction = world.get(entity, UIInteraction) as UIInteractionData;
                        if (interaction.hovered) {
                            bestEntity = entity;
                        }
                    }

                    if (bestEntity !== null) {
                        pendingEntity = bestEntity;
                        pendingStartWorld = { x: worldMouse.x, y: worldMouse.y };

                        if (!world.has(bestEntity, DragState)) {
                            world.insert(bestEntity, DragState);
                        }
                        const dragState = world.get(bestEntity, DragState) as DragStateData;
                        const wt = world.get(bestEntity, WorldTransform) as WorldTransformData;
                        dragState.startWorldPos = { x: wt.position.x, y: wt.position.y };
                        dragState.currentWorldPos = { x: wt.position.x, y: wt.position.y };
                        dragState.pointerStartWorld = { x: worldMouse.x, y: worldMouse.y };
                        dragState.deltaWorld = { x: 0, y: 0 };
                        dragState.totalDeltaWorld = { x: 0, y: 0 };
                        dragState.isDragging = false;
                    }
                }

                if (pendingEntity !== null && !input.isMouseButtonDown(0)) {
                    if (world.valid(pendingEntity) && world.has(pendingEntity, DragState)) {
                        const dragState = world.get(pendingEntity, DragState) as DragStateData;
                        dragState.isDragging = false;
                    }
                    pendingEntity = null;
                }

                if (pendingEntity !== null && activeEntity === null) {
                    if (!world.valid(pendingEntity)) {
                        pendingEntity = null;
                        return;
                    }
                    const dx = worldMouse.x - pendingStartWorld.x;
                    const dy = worldMouse.y - pendingStartWorld.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const draggable = world.get(pendingEntity, Draggable) as DraggableData;

                    const screenDist = dist * (camera.vpW / (camera.worldRight - camera.worldLeft));
                    if (screenDist >= draggable.dragThreshold) {
                        activeEntity = pendingEntity;
                        pendingEntity = null;

                        const dragState = world.get(activeEntity, DragState) as DragStateData;
                        dragState.isDragging = true;
                        events.emit(activeEntity, 'drag_start');
                    }
                }

                if (activeEntity !== null) {
                    if (!world.valid(activeEntity) || !world.has(activeEntity, DragState)) {
                        activeEntity = null;
                        return;
                    }

                    const dragState = world.get(activeEntity, DragState) as DragStateData;
                    const draggable = world.get(activeEntity, Draggable) as DraggableData;

                    const pointerDeltaX = worldMouse.x - dragState.pointerStartWorld.x;
                    const pointerDeltaY = worldMouse.y - dragState.pointerStartWorld.y;

                    let newWorldX = dragState.startWorldPos.x + pointerDeltaX;
                    let newWorldY = dragState.startWorldPos.y + pointerDeltaY;

                    const constrained = applyConstraints(draggable, dragState, newWorldX, newWorldY);
                    newWorldX = constrained.x;
                    newWorldY = constrained.y;

                    const prevX = dragState.currentWorldPos.x;
                    const prevY = dragState.currentWorldPos.y;
                    dragState.deltaWorld = { x: newWorldX - prevX, y: newWorldY - prevY };
                    dragState.currentWorldPos = { x: newWorldX, y: newWorldY };
                    dragState.totalDeltaWorld = {
                        x: newWorldX - dragState.startWorldPos.x,
                        y: newWorldY - dragState.startWorldPos.y,
                    };

                    if (world.has(activeEntity, LocalTransform)) {
                        const localDelta = worldToLocalDelta(
                            world, activeEntity,
                            dragState.deltaWorld.x, dragState.deltaWorld.y
                        );
                        const lt = world.get(activeEntity, LocalTransform) as LocalTransformData;
                        lt.position.x += localDelta.x;
                        lt.position.y += localDelta.y;
                        world.insert(activeEntity, LocalTransform, lt);
                    }

                    events.emit(activeEntity, 'drag_move');

                    if (input.isMouseButtonReleased(0)) {
                        dragState.isDragging = false;
                        events.emit(activeEntity, 'drag_end');
                        activeEntity = null;
                    }
                }
            },
            { name: 'DragSystem' }
        ));
    }
}

export const dragPlugin = new DragPlugin();
