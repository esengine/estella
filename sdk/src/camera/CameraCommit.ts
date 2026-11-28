// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    CameraCommit.ts
 * @brief   The camera the picture on screen was drawn from.
 * @details Anything that draws OVER the canvas — an editor's gizmo overlay, a
 *          DOM label pinned to a world point — has to project through the same
 *          camera the canvas did, or it lands somewhere the picture never was.
 *
 *          {@link UICameraInfo} cannot answer that. Its matrix is rewritten in
 *          place twice a frame (an early peek, then the authoritative resolve),
 *          so a reader on its own clock samples at an arbitrary phase and can
 *          get a camera no frame was ever drawn with — not stale, a third state.
 *
 *          This is a COPY, published once, after the draw. A reader holding it
 *          holds a moment rather than a view onto memory somebody else is still
 *          writing, and `revision` says which moment, so an overlay can be held
 *          to having used the same one.
 */
import { defineResource } from '../ecs/resource';
import type { Vec2 } from '../types';
import type { RebasedProjection } from '../ui/util/math';

/** @beta */
export interface CameraCommitData {
    /** The {@link UICameraData.revision} this frame was drawn with; 0 = none. */
    revision: number;
    /** The absolute view-projection, copied for this frame. */
    viewProjection: Float32Array;
    /** The render-space matrix and origin copied together when origin rebasing is active. */
    rebasedProjection?: RebasedProjection;
    /** World-space parallax override used by the editor view for this frame. */
    parallaxAnchor?: Readonly<Vec2>;
    /** Sorting-layer mask used to draw the committed screen camera. */
    cullingMask?: number;
    /** Where the picture landed, in window pixels. */
    vpX: number;
    vpY: number;
    vpW: number;
    vpH: number;
    /** False until a frame has been drawn with a camera at all. */
    valid: boolean;
}

/**
 * Told when the committed camera CHANGES — not when one is published.
 *
 * A commit happens on every drawn frame, so "a commit happened" says nothing
 * about what is on screen. Told the other question instead: looking for it on a
 * clock of one's own is a poll that never sleeps, or a change that lands late.
 * The camera plugin supplies its app's resource, including when it becomes invalid.
 * @beta
 */
export type CameraCommitListener = (source?: Readonly<CameraCommitData>) => void;

const listeners = new Set<CameraCommitListener>();

/** Subscribe to committed-camera changes. Returns an unsubscribe. @beta */
export function onCameraCommitChanged(fn: CameraCommitListener): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
}

/** Announce a change. Called by the camera plugin, after the submit. @beta */
export function cameraCommitChanged(source?: Readonly<CameraCommitData>): void {
    for (const fn of [...listeners]) fn(source);
}

/** The last drawn camera, as a resource. @beta */
export const CameraCommit = defineResource<CameraCommitData>({
    revision: 0,
    viewProjection: new Float32Array(16),
    vpX: 0, vpY: 0, vpW: 0, vpH: 0,
    valid: false,
}, 'CameraCommit');
