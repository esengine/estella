// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    xrPresentation.ts
 * @brief   What an immersive session shows this frame, as the render system reads it: the eyes, the framebuffer, and the
 *          arithmetic that puts an eye where the game's camera stands.
 *
 * @details A headset gives each eye its own projection (asymmetric: the lenses are not centred on the eyes) and its own pose,
 *          in metres, relative to where the session began. The game has a camera. The camera is the rig: where the player
 *          stands and which way the play space faces. Each eye is the rig's position and HEADING (yaw only) followed by the
 *          eye's own pose, so a third-person camera tilted down at its target does not tilt the player's horizon with it.
 *          The eye's metres are the world's units through `worldUnitsPerMeter`.
 *
 *          The session itself (immersive.ts) fills this in from the browser; nothing here touches WebXR, so the arithmetic
 *          is tested without a headset.
 */
import type { App } from '../app/app';
import { invertViewQuat, multiply } from '../math/mat4';

export interface Vec3Like { x: number; y: number; z: number }
export interface QuatLike { x: number; y: number; z: number; w: number }

/** One eye of this frame, as the session hands it over. */
export interface XREyeView {
    eye: 'left' | 'right' | 'none';
    /** Column-major, GL clip convention, built for the session's depthNear / depthFar. */
    projection: Float32Array;
    /** Where the eye is relative to the session's origin, in metres, and which way it looks. */
    position: Vec3Like;
    orientation: QuatLike;
    /** Its rectangle of the framebuffer, in pixels, bottom-left origin (the engine's viewport convention). */
    viewport: { x: number; y: number; w: number; h: number };
}

/** A pose the session reports, relative to its origin: metres, and a rotation. */
export interface XRPoseLike {
    position: Vec3Like;
    orientation: QuatLike;
}

/** Which hand a controller is in. */
export type XRHand = 'left' | 'right' | 'none';

/** One controller (or tracked hand) this frame, as the session reports it. */
export interface XRControllerState {
    hand: XRHand;
    /** Where the hand holds it (to draw a controller or a hand at), and where it points (to aim a ray from); null while not tracked. */
    grip: XRPoseLike | null;
    aim: XRPoseLike | null;
    /** The `xr-standard` gamepad: button values 0..1 (trigger, squeeze, touchpad, thumbstick, A/X, B/Y) and axes -1..1. */
    buttons: number[];
    touched: boolean[];
    axes: number[];
    /** What the browser says it is, most specific first (`oculus-touch-v3`, `generic-trigger-squeeze-thumbstick`). */
    profiles: readonly string[];
}

/** An immersive session's state, while one is presenting. */
export interface XRPresentationState {
    /** The eyes of the frame being drawn; empty when the headset reported no pose (tracking lost). */
    views: XREyeView[];
    framebufferWidth: number;
    framebufferHeight: number;
    /** The head relative to the session's origin, in metres: what a game reads to know where the player looks. */
    headPosition: Vec3Like;
    headOrientation: QuatLike;
    /** The clip planes the projections were built for, and the ones the rig camera asks for (the session takes them next frame). */
    depthNear: number;
    depthFar: number;
    wantNear: number;
    wantFar: number;
    /** The controllers the session tracks this frame. */
    controllers: XRControllerState[];
    /** The camera entity the eyes were last drawn from (the rig), 0 before the first frame. */
    rigEntity: number;
    /** True from the session's frame callback until the task after it: a frame drawn outside that window is not shown. */
    frameActive: boolean;
    /** Frames drawn to the headset, and frames drawn after their window closed (a system that awaited past it). */
    drawnFrames: number;
    missedFrames: number;
}

const presenting = new WeakMap<App, XRPresentationState>();

/** The app's immersive session state, or null when nothing presents. */
export function xrPresentation(app: App): XRPresentationState | null {
    return presenting.get(app) ?? null;
}

/** Sets (or, with null, clears) what the app presents to a headset. The session's own code calls this. */
export function setXRPresentation(app: App, state: XRPresentationState | null): void {
    if (state) presenting.set(app, state);
    else presenting.delete(app);
}

/** The heading of a rotation: the angle about +Y that turns -Z (forward) toward where it looks, flattened onto the ground. */
export function headingOf(q: QuatLike): number {
    // Forward is the rotation applied to (0, 0, -1).
    const fx = -2 * (q.x * q.z + q.w * q.y);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    if (Math.abs(fx) < 1e-9 && Math.abs(fz) < 1e-9) return 0;
    return Math.atan2(-fx, -fz);
}

function multiplyQuat(a: QuatLike, b: QuatLike): QuatLike {
    return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
}

/** Where the rig stands: a position in world units and a heading in radians about +Y. */
export interface XRRig {
    position: Vec3Like;
    heading: number;
}

/** An eye placed in the world: its pose there, and the view-projection the renderer is begun with. */
export interface PlacedEye {
    position: Vec3Like;
    orientation: QuatLike;
    viewProjection: Float32Array;
    /** The same view measured from `origin` (the render origin), for a world drawn relative to one. */
    renderViewProjection: Float32Array;
}

/** Puts a pose the session reports (metres, relative to its origin) in the world at `rig`. */
export function placePose(rig: XRRig, pose: XRPoseLike, unitsPerMeter: number): { position: Vec3Like; orientation: QuatLike } {
    const s = Math.sin(rig.heading / 2), c = Math.cos(rig.heading / 2);
    const turn: QuatLike = { x: 0, y: s, z: 0, w: c };
    // The offset turned by the heading (a rotation about Y): x and z swing, y stays.
    const cos = Math.cos(rig.heading), sin = Math.sin(rig.heading);
    const ex = pose.position.x * unitsPerMeter, ey = pose.position.y * unitsPerMeter, ez = pose.position.z * unitsPerMeter;
    return {
        position: { x: rig.position.x + cos * ex + sin * ez, y: rig.position.y + ey, z: rig.position.z - sin * ex + cos * ez },
        orientation: multiplyQuat(turn, pose.orientation),
    };
}

/** Puts `eye` in the world at `rig`, scaling its metres by `unitsPerMeter`. */
export function placeEye(rig: XRRig, eye: Pick<XREyeView, 'position' | 'orientation' | 'projection'>, unitsPerMeter: number,
    origin: Vec3Like = { x: 0, y: 0, z: 0 }): PlacedEye {
    const { position, orientation } = placePose(rig, eye, unitsPerMeter);
    const o = orientation;
    // Copied at once: `multiply` and `invertViewQuat` answer in buffers they reuse.
    const viewProjection = Float32Array.from(multiply(eye.projection, invertViewQuat(position.x, position.y, position.z, o.x, o.y, o.z, o.w)));
    const renderViewProjection = origin.x === 0 && origin.y === 0 && origin.z === 0
        ? Float32Array.from(viewProjection)
        : Float32Array.from(multiply(eye.projection,
            invertViewQuat(position.x - origin.x, position.y - origin.y, position.z - origin.z, o.x, o.y, o.z, o.w)));
    return { position, orientation, viewProjection, renderViewProjection };
}

/**
 * One view that sees everything the eyes see: from the middle of the head, with the union of the eyes' asymmetric fields,
 * measured from `origin` as the renderer is begun. Shadows are planned for it so both eyes read one atlas: per eye, each
 * eye's cascades were the other's stale ones and the atlas was drawn twice a frame and never kept.
 *
 * The eyes are taken to look the same way, as every headset's do; their fields are unioned in the first eye's orientation.
 */
export function sharedEyeView(rig: XRRig, eyes: readonly Pick<XREyeView, 'position' | 'orientation' | 'projection'>[], unitsPerMeter: number,
    origin: Vec3Like = { x: 0, y: 0, z: 0 }): Float32Array | null {
    if (eyes.length === 0) return null;
    let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity, near = Infinity, far = 0;
    const centre = { x: 0, y: 0, z: 0 };
    for (const eye of eyes) {
        const p = eye.projection;
        // A GL projection's frustum, as tangents of its four sides (x / -z and y / -z at the near plane) and its clip planes.
        left = Math.min(left, (p[8]! - 1) / p[0]!);
        right = Math.max(right, (p[8]! + 1) / p[0]!);
        bottom = Math.min(bottom, (p[9]! - 1) / p[5]!);
        top = Math.max(top, (p[9]! + 1) / p[5]!);
        near = Math.min(near, p[14]! / (p[10]! - 1));
        far = Math.max(far, p[14]! / (p[10]! + 1));
        centre.x += eye.position.x / eyes.length;
        centre.y += eye.position.y / eyes.length;
        centre.z += eye.position.z / eyes.length;
    }
    if (!(near > 0) || !(far > near)) return null;
    const projection = new Float32Array(16);
    const l = left * near, r = right * near, b = bottom * near, t = top * near;
    projection[0] = (2 * near) / (r - l);
    projection[5] = (2 * near) / (t - b);
    projection[8] = (r + l) / (r - l);
    projection[9] = (t + b) / (t - b);
    projection[10] = -(far + near) / (far - near);
    projection[11] = -1;
    projection[14] = (-2 * far * near) / (far - near);
    const placed = placePose(rig, { position: centre, orientation: eyes[0]!.orientation }, unitsPerMeter);
    const o = placed.orientation, at = placed.position;
    return Float32Array.from(multiply(projection,
        invertViewQuat(at.x - origin.x, at.y - origin.y, at.z - origin.z, o.x, o.y, o.z, o.w)));
}
