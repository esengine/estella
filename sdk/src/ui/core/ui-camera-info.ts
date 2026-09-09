// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { defineResource } from '../../ecs/resource';

/**
 * The surface UI lays out against: its pixel size and the scale mapping design
 * pixels onto it. Written by the camera plugin before layout runs.
 *
 * @beta
 */
export interface UICameraData {
    viewProjection: Float32Array;
    vpX: number;
    vpY: number;
    vpW: number;
    vpH: number;
    screenW: number;
    screenH: number;
    worldLeft: number;
    worldBottom: number;
    worldRight: number;
    worldTop: number;
    worldMouseX: number;
    worldMouseY: number;
    valid: boolean;
    /**
     * Which write of {@link UICameraData.viewProjection} this is.
     *
     * The matrix is rewritten IN PLACE twice a frame — an early peek, then the
     * resolve the renderer draws from — so a reader holds live memory and cannot
     * tell the two apart. This number can; `CameraCommit` is the drawn one.
     */
    revision: number;
}

/** The UI surface, as a resource — what a system reads to place something in
 *  screen terms rather than design terms.
 *  @beta */
export const UICameraInfo = defineResource<UICameraData>({
    viewProjection: new Float32Array(16),
    vpX: 0, vpY: 0, vpW: 0, vpH: 0,
    screenW: 0, screenH: 0,
    worldLeft: 0, worldBottom: 0, worldRight: 0, worldTop: 0,
    worldMouseX: 0, worldMouseY: 0,
    valid: false,
    revision: 0,
}, 'UICameraInfo');
