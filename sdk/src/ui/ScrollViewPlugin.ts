import type { App, Plugin } from '../app';
import { registerComponent, Transform, Children, Sprite } from '../component';
import type { TransformData, ChildrenData, SpriteData } from '../component';
import { defineSystem, Schedule } from '../system';
import { Res, Time } from '../resource';
import type { TimeData } from '../resource';
import { Input } from '../input';
import type { InputState } from '../input';
import type { Entity } from '../types';
import { ScrollView } from './ScrollView';
import type { ScrollViewData } from './ScrollView';
import { UIRect } from './UIRect';
import type { UIRectData } from './UIRect';
import { Interactable } from './Interactable';
import { UIMask, MaskMode } from './UIMask';
import { UIInteraction } from './UIInteraction';
import type { UIInteractionData } from './UIInteraction';
import { UICameraInfo } from './UICameraInfo';
import type { UICameraData } from './UICameraInfo';
import { isEditor, isPlayMode } from '../env';
import { getEffectiveWidth, getEffectiveHeight, ensureComponent, withChildEntity, EntityStateMap } from './uiHelpers';
import {
    SCROLL_MAX_DT, SCROLL_VELOCITY_THRESHOLD,
    SCROLL_VELOCITY_LERP_SPEED, SCROLL_ELASTIC_SMOOTH_TIME,
    SCROLL_ELASTIC_SNAP_THRESHOLD,
    SCROLL_MAX_OVERSCROLL_RATIO, SCROLL_MAX_VELOCITY_RATIO,
    SCROLL_POSITION_EPSILON,
} from './uiConstants';
import { SystemLabel, PluginName } from '../systemLabels';

function rubberBand(pos: number, min: number, max: number, viewSize: number): number {
    if (viewSize <= 0) return 1;
    if (pos < min) {
        return Math.max(0, 1 - (min - pos) / viewSize);
    } else if (pos > max) {
        return Math.max(0, 1 - (pos - max) / viewSize);
    }
    return 1;
}

function smoothDamp(
    current: number, target: number, currentVelocity: number,
    smoothTime: number, dt: number,
): { value: number; velocity: number } {
    smoothTime = Math.max(0.0001, smoothTime);
    const omega = 2 / smoothTime;
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = current - target;
    const temp = (currentVelocity + omega * change) * dt;
    const newVelocity = (currentVelocity - omega * temp) * exp;
    const newValue = target + (change + temp) * exp;
    if ((target - current > 0) === (newValue > target)) {
        return { value: target, velocity: 0 };
    }
    return { value: newValue, velocity: newVelocity };
}

interface ScrollState {
    isDragging: boolean;
    lastWorldX: number;
    lastWorldY: number;
    velocityX: number;
    velocityY: number;
    contentBaseX: number;
    contentBaseY: number;
    lastAppliedX: number;
    lastAppliedY: number;
}

export class ScrollViewPlugin implements Plugin {
    name = PluginName.ScrollView;
    dependencies = [PluginName.UILayout];

    private cleanup_: (() => void) | null = null;

    cleanup(): void {
        if (this.cleanup_) {
            this.cleanup_();
            this.cleanup_ = null;
        }
    }

    build(app: App): void {
        registerComponent('ScrollView', ScrollView);

        const world = app.world;
        const states = new EntityStateMap<ScrollState>();
        const worldMouse = { x: 0, y: 0 };

        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [Res(Input), Res(UICameraInfo), Res(Time)],
            (input: InputState, camera: UICameraData, time: TimeData) => {
                const editorSceneView = isEditor() && !isPlayMode();

                const dt = Math.min(time.delta, SCROLL_MAX_DT);

                states.cleanup(world);

                if (camera.valid) {
                    worldMouse.x = camera.worldMouseX;
                    worldMouse.y = camera.worldMouseY;
                }

                const entities = world.getEntitiesWithComponents([ScrollView, UIRect]);
                for (const entity of entities) {
                    ensureComponent(world, entity, UIMask, { enabled: true, mode: MaskMode.Scissor });

                    const sv = world.get(entity, ScrollView) as ScrollViewData;
                    const rect = world.get(entity, UIRect) as UIRectData;

                    const state = states.ensureInit(entity, () => ({
                        isDragging: false, lastWorldX: 0, lastWorldY: 0,
                        velocityX: 0, velocityY: 0,
                        contentBaseX: NaN, contentBaseY: NaN,
                        lastAppliedX: NaN, lastAppliedY: NaN,
                    }));

                    const viewW = getEffectiveWidth(rect, entity);
                    const viewH = getEffectiveHeight(rect, entity);

                    let effectiveContentW = sv.contentWidth;
                    let effectiveContentH = sv.contentHeight;
                    if ((effectiveContentW === 0 || effectiveContentH === 0)
                        && sv.contentEntity !== 0 && world.valid(sv.contentEntity)
                        && world.has(sv.contentEntity, Children)) {
                        const kids = (world.get(sv.contentEntity, Children) as ChildrenData).entities;
                        let minX = 0, maxX = 0, minY = 0, maxY = 0;
                        for (const child of kids) {
                            if (!world.valid(child) || !world.has(child, Transform)) continue;
                            const ct = world.get(child, Transform) as TransformData;
                            let cw = 0, ch = 0, px = 0.5, py = 0.5;
                            if (world.has(child, UIRect)) {
                                const cr = world.get(child, UIRect) as UIRectData;
                                cw = getEffectiveWidth(cr, child) || cr.size.x;
                                ch = getEffectiveHeight(cr, child) || cr.size.y;
                                px = cr.pivot.x;
                                py = cr.pivot.y;
                            } else if (world.has(child, Sprite)) {
                                const sp = world.get(child, Sprite) as SpriteData;
                                cw = sp.size.x;
                                ch = sp.size.y;
                            }
                            const left = ct.position.x - cw * px;
                            const right = ct.position.x + cw * (1 - px);
                            const bottom = ct.position.y - ch * py;
                            const top = ct.position.y + ch * (1 - py);
                            if (left < minX) minX = left;
                            if (right > maxX) maxX = right;
                            if (bottom < minY) minY = bottom;
                            if (top > maxY) maxY = top;
                        }
                        if (effectiveContentW === 0) effectiveContentW = maxX - minX;
                        if (effectiveContentH === 0) effectiveContentH = maxY - minY;
                    }

                    const maxScrollX = Math.max(0, effectiveContentW - viewW);
                    const maxScrollY = Math.max(0, effectiveContentH - viewH);

                    // --- Input ---
                    if (!editorSceneView && camera.valid) {
                        ensureComponent(world, entity, Interactable, { enabled: true, blockRaycast: true });

                        const interaction = world.has(entity, UIInteraction)
                            ? world.get(entity, UIInteraction) as UIInteractionData
                            : null;

                        if (interaction?.justPressed) {
                            state.isDragging = true;
                            state.lastWorldX = worldMouse.x;
                            state.lastWorldY = worldMouse.y;
                            state.velocityX = 0;
                            state.velocityY = 0;
                        }

                        if (state.isDragging && input.isMouseButtonDown(0)) {
                            const dx = worldMouse.x - state.lastWorldX;
                            const dy = worldMouse.y - state.lastWorldY;
                            const lerpFactor = Math.min(1, dt * SCROLL_VELOCITY_LERP_SPEED);

                            if (sv.horizontalEnabled) {
                                const rbX = rubberBand(sv.scrollX, 0, maxScrollX, viewW);
                                sv.scrollX -= dx * rbX;
                                if (dx === 0) {
                                    state.velocityX = 0;
                                } else {
                                    const instantVx = dt > 0 ? -dx * rbX / dt : 0;
                                    state.velocityX += (instantVx - state.velocityX) * lerpFactor;
                                }
                            }
                            if (sv.verticalEnabled) {
                                const rbY = rubberBand(sv.scrollY, 0, maxScrollY, viewH);
                                sv.scrollY += dy * rbY;
                                if (dy === 0) {
                                    state.velocityY = 0;
                                } else {
                                    const instantVy = dt > 0 ? dy * rbY / dt : 0;
                                    state.velocityY += (instantVy - state.velocityY) * lerpFactor;
                                }
                            }

                            state.lastWorldX = worldMouse.x;
                            state.lastWorldY = worldMouse.y;
                        }

                        if (state.isDragging && input.isMouseButtonReleased(0)) {
                            state.isDragging = false;
                            const maxVelX = viewW * SCROLL_MAX_VELOCITY_RATIO;
                            const maxVelY = viewH * SCROLL_MAX_VELOCITY_RATIO;
                            state.velocityX = Math.max(-maxVelX, Math.min(state.velocityX, maxVelX));
                            state.velocityY = Math.max(-maxVelY, Math.min(state.velocityY, maxVelY));
                        }

                        if (interaction?.hovered) {
                            const scroll = input.getScrollDelta();
                            if (sv.verticalEnabled && scroll.y !== 0) {
                                const rbY = rubberBand(sv.scrollY, 0, maxScrollY, viewH);
                                sv.scrollY += scroll.y * sv.wheelSensitivity * rbY;
                                state.velocityY = 0;
                            }
                            if (sv.horizontalEnabled && scroll.x !== 0) {
                                const rbX = rubberBand(sv.scrollX, 0, maxScrollX, viewW);
                                sv.scrollX += scroll.x * sv.wheelSensitivity * rbX;
                                state.velocityX = 0;
                            }
                        }
                    }

                    // --- Inertia & Elastic (after release) ---
                    if (!state.isDragging && dt > 0) {
                        const overX = sv.scrollX < 0 || sv.scrollX > maxScrollX;
                        const overY = sv.scrollY < 0 || sv.scrollY > maxScrollY;

                        if (sv.elastic && overX) {
                            const targetX = sv.scrollX < 0 ? 0 : maxScrollX;
                            const r = smoothDamp(sv.scrollX, targetX, state.velocityX, SCROLL_ELASTIC_SMOOTH_TIME, dt);
                            sv.scrollX = r.value;
                            state.velocityX = r.velocity;
                            if (Math.abs(sv.scrollX - targetX) < SCROLL_ELASTIC_SNAP_THRESHOLD
                                && Math.abs(state.velocityX) < SCROLL_VELOCITY_THRESHOLD) {
                                sv.scrollX = targetX;
                                state.velocityX = 0;
                            }
                        } else if (sv.inertia && sv.horizontalEnabled) {
                            if (Math.abs(state.velocityX) > SCROLL_VELOCITY_THRESHOLD) {
                                state.velocityX *= Math.pow(sv.decelerationRate, dt);
                                sv.scrollX += state.velocityX * dt;
                            } else {
                                state.velocityX = 0;
                            }
                        }

                        if (sv.elastic && overY) {
                            const targetY = sv.scrollY < 0 ? 0 : maxScrollY;
                            const r = smoothDamp(sv.scrollY, targetY, state.velocityY, SCROLL_ELASTIC_SMOOTH_TIME, dt);
                            sv.scrollY = r.value;
                            state.velocityY = r.velocity;
                            if (Math.abs(sv.scrollY - targetY) < SCROLL_ELASTIC_SNAP_THRESHOLD
                                && Math.abs(state.velocityY) < SCROLL_VELOCITY_THRESHOLD) {
                                sv.scrollY = targetY;
                                state.velocityY = 0;
                            }
                        } else if (sv.inertia && sv.verticalEnabled) {
                            if (Math.abs(state.velocityY) > SCROLL_VELOCITY_THRESHOLD) {
                                state.velocityY *= Math.pow(sv.decelerationRate, dt);
                                sv.scrollY += state.velocityY * dt;
                            } else {
                                state.velocityY = 0;
                            }
                        }

                        if (!sv.elastic) {
                            const prevX = sv.scrollX, prevY = sv.scrollY;
                            sv.scrollX = Math.max(0, Math.min(sv.scrollX, maxScrollX));
                            sv.scrollY = Math.max(0, Math.min(sv.scrollY, maxScrollY));
                            if (sv.scrollX !== prevX) state.velocityX = 0;
                            if (sv.scrollY !== prevY) state.velocityY = 0;
                        }
                    }

                    // Safety clamp overscroll
                    if (sv.elastic) {
                        const maxOverX = viewW * SCROLL_MAX_OVERSCROLL_RATIO;
                        const maxOverY = viewH * SCROLL_MAX_OVERSCROLL_RATIO;
                        sv.scrollX = Math.max(-maxOverX, Math.min(sv.scrollX, maxScrollX + maxOverX));
                        sv.scrollY = Math.max(-maxOverY, Math.min(sv.scrollY, maxScrollY + maxOverY));
                    }

                    withChildEntity(world, sv.contentEntity, (contentEntity) => {
                        if (!world.has(contentEntity, Transform)) return;
                        const lt = world.get(contentEntity, Transform) as TransformData;
                        const curX = lt.position.x;
                        const curY = lt.position.y;

                        if (isNaN(state.lastAppliedX) || Math.abs(curX - state.lastAppliedX) > SCROLL_POSITION_EPSILON) {
                            state.contentBaseX = curX;
                        }
                        if (isNaN(state.lastAppliedY) || Math.abs(curY - state.lastAppliedY) > SCROLL_POSITION_EPSILON) {
                            state.contentBaseY = curY;
                        }

                        lt.position.x = state.contentBaseX - sv.scrollX;
                        lt.position.y = state.contentBaseY + sv.scrollY;

                        state.lastAppliedX = lt.position.x;
                        state.lastAppliedY = lt.position.y;
                        world.insert(contentEntity, Transform, lt);
                    });
                }
            },
            { name: 'ScrollViewSystem' }
        ), { runAfter: [SystemLabel.UILayoutLate], runBefore: [SystemLabel.UIRenderOrder] });

        this.cleanup_ = () => {
            states.clear();
        };
    }
}

export const scrollViewPlugin = new ScrollViewPlugin();
