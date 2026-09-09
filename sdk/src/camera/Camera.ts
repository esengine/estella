// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App } from '../app/app';
import { defineResource } from '../ecs/resource';
import { UICameraInfo, type UICameraData } from '../ui/core/ui-camera-info';
import { CameraCommit } from './CameraCommit';
import type { Vec3 } from '../types';
import { screenToWorld, projectWorldPoint, projectDirectionAt, nearPlaneSide, isProjectable, createInvVPCache, screenRay, type WorldRay } from '../ui/util/math';

/**
 * Per-App camera-space query API: screen<->world conversions, the world-space
 * mouse position, and the active camera's world bounds.
 *
 * Reads the per-App {@link UICameraInfo} resource. Each App holds its own
 * instance (published as the {@link CameraView} resource) and its own
 * inverse-view-projection cache, so two Apps running at once never share a
 * single cached `app` or clobber each other's cache.
 */
/** How far inside the near plane a cut lands, as a fraction of the segment. */
const CLIP_NUDGE = 1e-4;

/**
 * The camera as a LENS — what a projection needs, and nothing about the surface.
 *
 * Narrower than {@link UICameraData} on purpose: it is the part two different
 * cameras can both supply, one being resolved and one already drawn with.
 * @beta
 */
export interface CameraLens {
    viewProjection: Float32Array;
    vpX: number;
    vpY: number;
    vpW: number;
    vpH: number;
}

/** The camera currently being resolved — moves twice a frame. */
const liveLens = (app: App): CameraLens | null => {
    const cam: UICameraData = app.getResource(UICameraInfo);
    return cam.valid ? cam : null;
};

/** The camera the last frame was drawn with. */
const committedLens = (app: App): CameraLens | null => {
    const commit = app.getResource(CameraCommit);
    return commit.valid ? commit : null;
};

export class CameraViewAPI {
    private readonly invVPCache = createInvVPCache();

    /**
     * @param lens_ Which camera this view answers for. The default is the one
     *              being resolved — what a system inside the frame wants.
     *              Anything aligning to the PICTURE wants
     *              {@link PresentedCameraView}: the live one moves mid-frame and
     *              can hold a state no frame was drawn from.
     */
    constructor(
        private readonly app_: App,
        private readonly lens_: (app: App) => CameraLens | null = liveLens,
    ) {}

    private cam(): CameraLens | null {
        return this.lens_(this.app_);
    }

    /**
     * The live UI surface, for the two answers that are not projections.
     *
     * Where the pointer is and what box UI lays out within are facts about the
     * surface as it stands, not about a picture that was drawn — so they read
     * the live resource even on a view over the committed camera.
     */
    private surface(): UICameraData | null {
        const cam = this.app_.getResource(UICameraInfo);
        return cam.valid ? cam : null;
    }

    /**
     * Where a screen point lands on the world plane at @p planeZ.
     *
     * A screen point is a ray. Orthographically its x/y do not vary along it, so
     * the plane is irrelevant and the default answers for everyone. Under a
     * perspective camera it decides the answer, and the right plane is the one
     * the thing being hit or dragged actually sits on — z = 0 would place a
     * sprite at z = -400 wherever its shadow on the 2D plane happens to fall.
     */
    screenToWorld(screenX: number, screenY: number, planeZ = 0): { x: number; y: number } | null {
        const cam = this.cam();
        if (!cam) return null;
        this.invVPCache.update(cam.viewProjection);
        const invVP = this.invVPCache.getInverse(cam.viewProjection);
        return screenToWorld(screenX, screenY, invVP, cam.vpX, cam.vpY, cam.vpW, cam.vpH, planeZ);
    }

    /**
     * The world ray a screen point names — what `screenToWorld` intersects with
     * the z plane. Callers that drag along an arbitrary plane (an editor moving
     * along a world axis, a pick against the ground) need the ray itself: a
     * z-keyed answer cannot express a plane that is not z-keyed.
     */
    screenRay(screenX: number, screenY: number): WorldRay | null {
        const cam = this.cam();
        if (!cam) return null;
        this.invVPCache.update(cam.viewProjection);
        const invVP = this.invVPCache.getInverse(cam.viewProjection);
        return screenRay(screenX, screenY, invVP, cam.vpX, cam.vpY, cam.vpW, cam.vpH);
    }

    /**
     * Where the world point lands on screen — the inverse of `screenToWorld`,
     * taking the same third dimension. Under a perspective camera a point at
     * @p worldZ projects nowhere near its shadow on the 2D plane, so anything
     * drawing an overlay ON an entity (an outline, a gizmo, a screen rect) has to
     * pass the entity's z or it draws where the entity is not.
     *
     * Null means the point has NO screen position: no camera, or it stands at or
     * behind the eye, where the divide mirrors it to the far side of the view.
     * Outside the viewport is NOT that, and keeps its coordinates.
     */
    worldToScreen(worldX: number, worldY: number, worldZ = 0): { x: number; y: number } | null {
        const cam = this.cam();
        if (!cam) return null;
        const p = projectWorldPoint(worldX, worldY, worldZ,
                                    cam.viewProjection, cam.vpX, cam.vpY, cam.vpW, cam.vpH);
        return isProjectable(p) ? { x: p.x, y: p.y } : null;
    }

    /**
     * The part of segment @p a → @p b that can be drawn, cut at the near plane.
     *
     * @details One end behind the eye still leaves a visible part, and dropping the
     *          whole segment is what makes a wireframe come apart as the eye moves
     *          into it. Null when none of it is in front.
     */
    clipSegment(a: Vec3, b: Vec3): { a: Vec3; b: Vec3 } | null {
        const cam = this.cam();
        if (!cam) return null;
        const at = (p: Vec3) => projectWorldPoint(p.x, p.y, p.z,
                                                  cam.viewProjection, cam.vpX, cam.vpY, cam.vpW, cam.vpH);
        const sa = nearPlaneSide(at(a));
        const sb = nearPlaneSide(at(b));
        if (sa >= 0 && sb >= 0) return { a, b };
        if (sa < 0 && sb < 0) return null;
        const cross = sa / (sa - sb);
        const t = sa >= 0 ? cross * (1 - CLIP_NUDGE) : cross + (1 - cross) * CLIP_NUDGE;
        const cut = {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
            z: a.z + (b.z - a.z) * t,
        };
        return sa >= 0 ? { a, b: cut } : { a: cut, b };
    }

    /**
     * Where a world DIRECTION points on screen at @p at — px per world unit, y-up.
     *
     * @details Null when @p at has no projection. Perspective makes this a fact
     *          about the POINT: an arm drawn on something asks here, where a basis
     *          read off the camera answers only for the centre of the view.
     */
    projectDirectionAt(at: Vec3, dir: Vec3): { x: number; y: number } | null {
        const cam = this.cam();
        if (!cam) return null;
        const p = projectWorldPoint(at.x, at.y, at.z,
                                    cam.viewProjection, cam.vpX, cam.vpY, cam.vpW, cam.vpH);
        if (!isProjectable(p)) return null;
        return projectDirectionAt(p, dir.x, dir.y, dir.z,
                                  cam.viewProjection, cam.vpX, cam.vpY, cam.vpW, cam.vpH);
    }

    getWorldMousePosition(): { x: number; y: number } | null {
        const cam = this.surface();
        if (!cam) return null;
        return { x: cam.worldMouseX, y: cam.worldMouseY };
    }

    getWorldBounds(): { left: number; right: number; bottom: number; top: number } | null {
        const cam = this.surface();
        if (!cam) return null;
        return { left: cam.worldLeft, right: cam.worldRight, bottom: cam.worldBottom, top: cam.worldTop };
    }
}

/**
 * Per-App camera-query API resource, published by `corePlugin`. Read it as
 * `app.getResource(CameraView)` to convert screen<->world etc. (Named
 * `CameraView` rather than `Camera` because `Camera` is the ECS component.)
 */
export const CameraView = defineResource<CameraViewAPI>(null!, 'CameraView');

/**
 * The same queries, against the camera the last frame was actually drawn with.
 *
 * One implementation, two sources: a second projection written over the commit
 * would be a second near-plane cut to keep in step, and a wireframe cut by one
 * and drawn by the other comes apart exactly where a segment leaves the view.
 * @beta
 */
export const PresentedCameraView = defineResource<CameraViewAPI>(null!, 'PresentedCameraView');

/** A view over the camera the last frame was drawn with. @beta */
export const presentedCameraView = (app: App): CameraViewAPI => new CameraViewAPI(app, committedLens);
