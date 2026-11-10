// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    world-anchor.ts
 * @brief   A UI node that stands over a point in the 3D world: an objective marker, a name over a head, a health bar.
 *
 * @details Placed from the camera's pose as it stands at the end of Update, not from the matrix the camera plugin
 *          resolved at the start of the frame: a first-person view turns in Update, and a marker read off the early
 *          matrix trails the view by a frame and swims as the player looks around.
 */
import type { App, Plugin } from '../../app/app';
import { defineComponent, type ComponentDef, Transform, Camera } from '../../ecs/component';
import type { TransformData, CameraData } from '../../ecs/component';
import type { World } from '../../ecs/world';
import { defineSystem, GetWorld, Schedule } from '../../ecs/system';
import { Res } from '../../ecs/resource';
import { SystemLabel } from '../../ecs/systemLabels';
import type { Entity, Quat, Vec3 } from '../../types';
import { ProjectionType, ClearFlags } from '../../wasm/wasm.generated';
import { UINode, UIDisplay, UIPositionType, type UINodeData } from './ui-node';
import { px } from './dimension';
import { ScreenLayout, type ScreenLayoutData } from './screen-layout';

export interface UIWorldAnchorData {
    /** The entity to stand over; 0 = the world point `offset`. */
    target: Entity;
    /** Added to the target's world position (world units); the world point itself when there is no target. */
    offset: Vec3;
    /** The camera that looks; 0 = the active camera that clears colour with the highest priority (the view on screen). */
    camera: Entity;
    /** Off screen or behind the camera, stand at the screen's edge in the point's direction instead (an objective marker). */
    clampToEdges: boolean;
    /** How far inside the edge a clamped marker stands, in layout pixels. */
    edgeMargin: number;
    /** Behind the camera and not clamped: hide (display None) rather than stand where the projection mirrors it. */
    hideWhenBehind: boolean;
    /** Read back: the point is in front of the camera and inside the screen. */
    onScreen: boolean;
    /** Read back: the point is behind the camera. */
    behind: boolean;
    /** Read back: world distance from the camera. */
    distance: number;
}

/**
 * Puts the UINode it is on at the screen position of a world point, every frame. The node is placed Absolute, by its
 * left/top insets, in its parent — which is expected to cover the screen (a screen Canvas root or a full-screen
 * panel). Centre it on the point with negative margins of half its size.
 *
 * @experimental
 */
export const UIWorldAnchor: ComponentDef<UIWorldAnchorData> = defineComponent<UIWorldAnchorData>('UIWorldAnchor', {
    target: 0 as Entity,
    offset: { x: 0, y: 0, z: 0 },
    camera: 0 as Entity,
    clampToEdges: false,
    edgeMargin: 24,
    hideWhenBehind: true,
    onScreen: false,
    behind: false,
    distance: 0,
}, {
    entityFields: ['target', 'camera'],
    readonlyFields: ['onScreen', 'behind', 'distance'],
    fields: {
        target: { tooltip: 'The entity to stand over. Empty: stand over the world point Offset.' },
        offset: { tooltip: 'Added to the target\'s position (world units): above a head, at a door. The point itself with no target.' },
        camera: { advanced: true, tooltip: 'The camera that looks. Empty: the camera on screen.' },
        clampToEdges: { tooltip: 'Off screen, stand at the edge in its direction instead of leaving it.' },
        edgeMargin: { min: 0, advanced: true, shownWhen: { field: 'clampToEdges', values: [1] } },
        hideWhenBehind: { advanced: true },
        onScreen: { advanced: true },
        behind: { advanced: true },
        distance: { advanced: true },
    },
});

/** The eye a projection is made from: where it is, which way it turns, and its lens. */
export interface AnchorLens {
    position: Vec3;
    rotation: Quat;
    perspective: boolean;
    /** Vertical field of view, degrees (perspective). */
    fov: number;
    /** Half the visible height, world units (orthographic). */
    orthoSize: number;
    near: number;
}

export interface AnchorPlacement {
    /** Layout pixels from the left and from the top of the screen box. */
    left: number;
    top: number;
    onScreen: boolean;
    behind: boolean;
    distance: number;
}

function rotateInverse(q: Quat, v: Vec3): Vec3 {
    // conjugate(q) * v * q, for a unit q
    const x = -q.x, y = -q.y, z = -q.z, w = q.w;
    const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
    return { x: v.x + w * tx + (y * tz - z * ty), y: v.y + w * ty + (z * tx - x * tz), z: v.z + w * tz + (x * ty - y * tx) };
}

/**
 * Where a world point stands on the screen box, in layout pixels from its top-left corner. Pure: the system below
 * and the tests share it.
 *
 * Behind the eye a perspective projection mirrors the point to the opposite side; a clamped marker is put on the edge
 * in the point's true direction instead.
 */
export function placeOnScreen(point: Vec3, lens: AnchorLens, box: { width: number; height: number },
                              clamp: boolean, margin: number): AnchorPlacement {
    const rel = { x: point.x - lens.position.x, y: point.y - lens.position.y, z: point.z - lens.position.z };
    const distance = Math.hypot(rel.x, rel.y, rel.z);
    const v = rotateInverse(lens.rotation, rel);               // camera space: -z ahead
    const aspect = box.width / Math.max(box.height, 1e-6);
    let nx: number, ny: number;
    let behind = false;
    if (lens.perspective) {
        const depth = -v.z;
        behind = depth <= Math.max(lens.near, 1e-4);
        const t = Math.tan((lens.fov * Math.PI) / 360);
        const d = behind ? Math.max(Math.abs(depth), 1e-4) : depth;
        nx = v.x / (d * t * aspect);
        ny = v.y / (d * t);
    } else {
        nx = v.x / (lens.orthoSize * aspect);
        ny = v.y / lens.orthoSize;
    }
    const onScreen = !behind && Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
    if (clamp && !onScreen) {
        // Out to the edge along the point's direction from the centre; behind, a point straight ahead of the camera
        // would read as the centre, so a direction that has nearly vanished is pushed to the bottom edge.
        let dx = nx, dy = ny;
        if (behind && Math.hypot(dx, dy) < 1e-3) { dx = 0; dy = -1; }
        const mx = 1 - (2 * margin) / Math.max(box.width, 1e-6), my = 1 - (2 * margin) / Math.max(box.height, 1e-6);
        const k = Math.max(Math.abs(dx) / mx, Math.abs(dy) / my, 1e-6);
        nx = dx / k; ny = dy / k;
    }
    return { left: (nx * 0.5 + 0.5) * box.width, top: (0.5 - ny * 0.5) * box.height, onScreen, behind, distance };
}

/** The camera on screen: the active one that clears colour, highest priority first. */
function screenCamera(world: World): Entity | null {
    let best: Entity | null = null, bestPriority = -Infinity;
    for (const e of world.getEntitiesWithComponents([Camera, Transform])) {
        const c = world.get(e, Camera) as CameraData;
        if (!c.isActive || (c.clearFlags & ClearFlags.Color) === 0) continue;
        if (c.priority > bestPriority) { best = e; bestPriority = c.priority; }
    }
    return best;
}

/** The nodes an anchor hid for standing behind the camera — the only ones it shows again. */
const hiddenByAnchor = new Set<Entity>();

export function stepWorldAnchors(world: World, screen: ScreenLayoutData): void {
    if (!screen.valid) return;
    const anchors = world.getEntitiesWithComponents([UIWorldAnchor, UINode]);
    if (anchors.length === 0) return;
    world.ensureTransformsComposed();
    const box = { width: screen.right - screen.left, height: screen.top - screen.bottom };
    const auto = screenCamera(world);
    for (const e of anchors) {
        const a = world.get(e, UIWorldAnchor) as UIWorldAnchorData;
        const camEntity = a.camera !== 0 && world.valid(a.camera) && world.has(a.camera, Camera) ? a.camera : auto;
        if (camEntity === null) continue;
        const cam = world.get(camEntity, Camera) as CameraData;
        const ct = world.get(camEntity, Transform) as TransformData;
        const lens: AnchorLens = {
            position: ct.worldPosition as Vec3, rotation: ct.worldRotation as Quat,
            perspective: cam.projectionType === ProjectionType.Perspective,
            fov: cam.fov, orthoSize: cam.orthoSize, near: cam.nearPlane,
        };
        let point: Vec3 = a.offset;
        if (a.target !== 0 && world.valid(a.target) && world.has(a.target, Transform)) {
            const tp = (world.get(a.target, Transform) as TransformData).worldPosition as Vec3;
            point = { x: tp.x + a.offset.x, y: tp.y + a.offset.y, z: tp.z + a.offset.z };
        }
        const at = placeOnScreen(point, lens, box, a.clampToEdges, a.edgeMargin);
        const hide = at.behind && !a.clampToEdges && a.hideWhenBehind;
        const node = world.get(e, UINode) as UINodeData;
        const left = Math.round(at.left * 10) / 10, top = Math.round(at.top * 10) / 10;
        // The anchor hides a node only while the point is behind, and shows again only a node IT hid: a game that hid a
        // marker itself (an objective done) keeps it hidden.
        let display = node.display;
        if (hide && node.display !== UIDisplay.None) { display = UIDisplay.None; hiddenByAnchor.add(e); }
        else if (!hide && hiddenByAnchor.has(e)) { display = UIDisplay.Flex; hiddenByAnchor.delete(e); }
        // Written only when it changed: a write dirties the layout tree.
        if (node.position !== UIPositionType.Absolute || node.display !== display
            || node.insetLeft.value !== left || node.insetTop.value !== top) {
            world.update(e, UINode, (n: UINodeData) => {
                n.position = UIPositionType.Absolute; n.display = display;
                n.insetLeft = px(left); n.insetTop = px(top);
            });
        }
        if (a.onScreen !== at.onScreen || a.behind !== at.behind || Math.abs(a.distance - at.distance) > 1e-3) {
            world.update(e, UIWorldAnchor, (w: UIWorldAnchorData) => { w.onScreen = at.onScreen; w.behind = at.behind; w.distance = at.distance; });
        }
    }
}

export class UIWorldAnchorPlugin implements Plugin {
    name = 'uiWorldAnchor';
    build(app: App): void {
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem(
            [GetWorld(), Res(ScreenLayout)],
            (world: World, screen: ScreenLayoutData) => stepWorldAnchors(world, screen),
            { name: 'UIWorldAnchorSystem', touches: { reads: ['Camera', 'Transform'], writes: ['UINode', 'UIWorldAnchor'] } },
        ), { runBefore: [SystemLabel.UILayoutLate] });
    }
}

export const uiWorldAnchorPlugin = new UIWorldAnchorPlugin();
