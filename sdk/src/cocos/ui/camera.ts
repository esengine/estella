// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/ui/camera.ts
 * @brief   `Camera`: a view on the engine's `Camera`, with Cocos's names and the conversions scripts use it for.
 *
 * Every setting is the engine camera's, renamed (`orthoHeight` is its `orthoSize`, `visibility` its `cullingMask`, `rect` its
 * `viewport`) and `projection` translated, since the two number the kinds the other way round. The conversions go through the
 * UI camera — the one that draws the scene's UI and world content — so `screenToWorld(touch.getLocation())` lands where the
 * finger is, which is what a script that has a camera in hand wants.
 *
 * Not carried: `clearColor` and `clearFlags` are held so a script can read back what it set, but the engine's clear belongs to its
 * renderer settings, not to the camera.
 */
import { Camera as EngineCamera, type CameraData } from '../../ecs/component';
import type { World } from '../../ecs/world';
import type { Entity } from '../../types';
import { isProjectable, projectWorldPoint } from '../../ui/util/math';
import { screenToUiWorld } from '../../ui/util/ui-pick';
import { Color, Rect, Vec3 } from '../math';
import { Ray } from '../geometry';
import { Component } from '../component';
import { registerBuiltinComponent } from '../builtins';
import type { Node } from '../node';
import { viewAdapter } from './view';
import { UITransform } from './uiTransform';
import { getWindowPixels, uiCameraData } from './screen';

const ProjectionType = Object.freeze({ ORTHO: 0, PERSPECTIVE: 1 });
const FOVAxis = Object.freeze({ VERTICAL: 0, HORIZONTAL: 1 });
const ClearFlag = Object.freeze({ DONT_CLEAR: 0, DEPTH_ONLY: 6, SOLID_COLOR: 7, SKYBOX: 14 });

/** The engine's camera types: 0 perspective, 1 orthographic. */
const ENGINE_ORTHO = 1;

export class Camera extends Component {
    static readonly ProjectionType = ProjectionType;
    static readonly FOVAxis = FOVAxis;
    static readonly ClearFlag = ClearFlag;

    private data_(): CameraData { return this._world.get(this._entity, EngineCamera); }
    private patch_(patch: Partial<CameraData>): void { this._world.set(this._entity, EngineCamera, { ...this.data_(), ...patch }); }

    private clearColor_ = new Color(0, 0, 0, 255);
    private clearFlags_: number = ClearFlag.SOLID_COLOR;

    get projection(): number { return this.data_().projectionType === ENGINE_ORTHO ? ProjectionType.ORTHO : ProjectionType.PERSPECTIVE; }
    set projection(v: number) { this.patch_({ projectionType: v === ProjectionType.ORTHO ? ENGINE_ORTHO : 0 }); }

    /** Half the visible height in world units, as in Cocos. */
    get orthoHeight(): number { return this.data_().orthoSize; }
    set orthoHeight(v: number) { this.patch_({ orthoSize: v }); }

    get fov(): number { return this.data_().fov; }
    set fov(v: number) { this.patch_({ fov: v }); }
    get fovAxis(): number { return FOVAxis.VERTICAL; }

    get near(): number { return this.data_().nearPlane; }
    set near(v: number) { this.patch_({ nearPlane: v }); }
    get far(): number { return this.data_().farPlane; }
    set far(v: number) { this.patch_({ farPlane: v }); }

    get priority(): number { return this.data_().priority; }
    set priority(v: number) { this.patch_({ priority: v }); }

    /** The layers this camera draws, as a bitmask. */
    get visibility(): number { return this.data_().cullingMask >>> 0; }
    set visibility(v: number) { this.patch_({ cullingMask: v >>> 0 }); }

    /** The part of the window it draws into, 0..1. */
    get rect(): Rect { const v = this.data_().viewport; return new Rect(v.x, v.y, v.z, v.w); }
    set rect(r: Rect) { this.patch_({ viewport: { x: r.x, y: r.y, z: r.width, w: r.height } }); }

    get clearFlags(): number { return this.clearFlags_; }
    set clearFlags(v: number) { this.clearFlags_ = v; }
    get clearColor(): Color { return this.clearColor_.clone(); }
    set clearColor(v: Color) { this.clearColor_ = v.clone(); }

    get enabled(): boolean { return this.data_().isActive; }
    set enabled(v: boolean) { this.patch_({ isActive: v }); }

    /**
     * The world point under a screen point (pixels of the drawing surface, origin bottom-left — what `EventTouch.getLocation`
     * gives). @p screenPos.z is the depth along the view ray; for a flat scene it does not change x and y.
     */
    screenToWorld(screenPos: Vec3, out: Vec3 = new Vec3()): Vec3 {
        const cam = uiCameraData();
        if (!cam?.valid) return out.set(0, 0, 0);
        const w = screenToUiWorld(cam, screenPos.x, screenPos.y);
        return out.set(w.x, w.y, 0);
    }

    /**
     * The ray from the camera through a screen point (pixels of the drawing surface, origin bottom-left): from the camera's own pose and lens,
     * so a perspective camera's rays fan out from its position and an orthographic one's run parallel.
     */
    screenPointToRay(x: number, y: number, out: Ray = new Ray()): Ray {
        const surface = getWindowPixels();
        const width = surface.width > 0 ? surface.width : 1;
        const height = surface.height > 0 ? surface.height : 1;
        const lens = this.data_();
        const nx = (x / width) * 2 - 1;
        const ny = (y / height) * 2 - 1;
        const aspect = width / height;
        const rotation = this.node.getWorldRotation();
        const position = this.node.getWorldPosition();
        const turn = (v: Vec3): Vec3 => Vec3.transformQuat(new Vec3(), v, rotation);
        if (lens.projectionType === ENGINE_ORTHO) {
            const half = lens.orthoSize;
            const origin = turn(new Vec3(nx * half * aspect, ny * half, 0));
            const dir = turn(new Vec3(0, 0, -1));
            out.o.set(position.x + origin.x, position.y + origin.y, position.z + origin.z);
            out.d.set(dir.x, dir.y, dir.z);
            return out;
        }
        const reach = Math.tan((lens.fov * Math.PI) / 360);
        const dir = turn(new Vec3(nx * reach * aspect, ny * reach, -1)).normalize();
        out.o.set(position.x, position.y, position.z);
        out.d.set(dir.x, dir.y, dir.z);
        return out;
    }

    /** The screen point (surface pixels, origin bottom-left) a world point lands on. */
    worldToScreen(worldPos: Vec3, out: Vec3 = new Vec3()): Vec3 {
        const cam = uiCameraData();
        if (!cam?.valid) return out.set(0, 0, 0);
        const p = projectWorldPoint(worldPos.x, worldPos.y, worldPos.z, cam.viewProjection, cam.vpX, cam.vpY, cam.vpW, cam.vpH);
        return isProjectable(p) ? out.set(p.x, p.y, 0) : out.set(0, 0, 0);
    }

    /** A world point as a point in @p uiNode's space (relative to its anchor): where to put something there that is at @p worldPos. */
    convertToUINode(worldPos: Vec3, uiNode: Node, out: Vec3 = new Vec3()): Vec3 {
        const t = uiNode.getComponent(UITransform);
        if (!t) return out.set(worldPos.x, worldPos.y, worldPos.z);
        return t.convertToNodeSpaceAR(worldPos, out);
    }
}

const hasCamera = (world: World, entity: Entity): boolean => world.has(entity, EngineCamera);
const addCamera = (world: World, entity: Entity): void => { world.insert(entity, EngineCamera, {}); };

registerBuiltinComponent(Camera, ['cc.Camera', 'Camera'], viewAdapter(Camera, hasCamera, addCamera));
