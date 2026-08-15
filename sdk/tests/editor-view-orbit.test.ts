// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The editor's eye, turned off the -Z axis.
 *
 * A 3D scene cannot be looked at head-on only, and every 2D projection has to
 * stay exactly what it was: the head-on case is asserted matrix-for-matrix, the
 * turned one against where a point lands.
 */
import { describe, expect, it } from 'vitest';
import { invertViewZ, invertViewOrbit, multiply, perspective, ortho } from '../src/math/mat4';
import { editorCameraInfo } from '../src/camera/CameraPlugin';
import {
    DEFAULT_EDITOR_VIEW, editorViewIsOrbited, editorViewAxes, editorViewAxisAngles, editorViewHalfHeight,
} from '../src/camera/EditorView';
import { screenToWorld, invertMatrix4 } from '../src/ui/util/math';

const project = (vp: Float32Array, x: number, y: number, z: number) => {
    const w = vp[3]! * x + vp[7]! * y + vp[11]! * z + vp[15]!;
    return {
        x: (vp[0]! * x + vp[4]! * y + vp[8]! * z + vp[12]!) / w,
        y: (vp[1]! * x + vp[5]! * y + vp[9]! * z + vp[13]!) / w,
    };
};

describe('the editor view, orbited', () => {
    it('is the head-on view exactly when yaw and pitch are zero', () => {
        // If these ever differ, turning the feature on moves every 2D scene.
        // Signed zero is normalized: -0 and 0 are one entry of a matrix.
        const cells = (m: Float32Array) => Array.from(m, v => v + 0);
        expect(cells(invertViewOrbit(30, -40, 0, 0, 0, 500)))
            .toEqual(cells(invertViewZ(30, -40, 500, 1, 0)));
    });

    it('puts the eye where yaw says, looking back at the focus', () => {
        // Yaw 90° stands the eye on +X: the focus still projects to the centre,
        // and what was to the camera's right is now nearer or further, not sideways.
        const view = invertViewOrbit(0, 0, 0, Math.PI / 2, 0, 100);
        const vp = multiply(perspective(Math.PI / 3, 1, 0.1, 1000), view);
        const centre = project(vp, 0, 0, 0);
        expect(centre.x).toBeCloseTo(0);
        expect(centre.y).toBeCloseTo(0);
        // A point along +Z is now to the LEFT of the eye standing on +X.
        expect(project(vp, 0, 0, 50).x).toBeLessThan(-0.01);
        expect(project(vp, 0, 0, -50).x).toBeGreaterThan(0.01);
    });

    it('raises the eye with pitch, keeping the focus centred', () => {
        const view = invertViewOrbit(10, 20, 0, 0, Math.PI / 4, 200);
        const vp = multiply(ortho(-100, 100, -100, 100, -1000, 1000), view);
        const centre = project(vp, 10, 20, 0);
        expect(centre.x).toBeCloseTo(0);
        expect(centre.y).toBeCloseTo(0);
        // Looking down at 45°, ground that is further away rides UP the screen.
        expect(project(vp, 10, -80, 0).y).toBeLessThan(project(vp, 10, 120, 0).y);
    });

    it('carries the orbit into the camera the editor renders through', () => {
        const view = { ...DEFAULT_EDITOR_VIEW, active: true, yaw: 90, pitch: 0 };
        expect(editorViewIsOrbited(view)).toBe(true);
        const cam = editorCameraInfo(view, 256, 256, []);
        // Same claim as the matrix test, through the camera the editor builds.
        expect(project(cam.viewProjection, 0, 0, 0).x).toBeCloseTo(0);
        expect(project(cam.viewProjection, 0, 0, 100).x).toBeLessThan(-0.01);
    });

    it('hit-tests through the turned view: a screen point still finds z = 0', () => {
        // Picking is a ray against the z = 0 plane, so an orbited view has to
        // answer with the point under the cursor rather than one beside it.
        const view = { ...DEFAULT_EDITOR_VIEW, active: true, yaw: 30, pitch: 20 };
        const cam = editorCameraInfo(view, 256, 256, []);
        const inv = invertMatrix4(cam.viewProjection);
        const centre = screenToWorld(128, 128, inv, 0, 0, 256, 256, 0);
        expect(centre.x).toBeCloseTo(view.x, 3);
        expect(centre.y).toBeCloseTo(view.y, 3);
    });
});

describe('what the view sees', () => {
    // The zoom readout is canvas height / (2 × half-height). Were the camera to
    // frame a different extent, every percentage shown would be off by that factor.
    it.each([
        ['orthographic', { orthoSize: 200 }],
        ['perspective', { perspective: true, fov: 60, distance: 1000 }],
    ])('puts its half-height on the top edge, %s', (_name, over) => {
        const view = { ...DEFAULT_EDITOR_VIEW, active: true, ...over };
        const cam = editorCameraInfo(view, 400, 300, []);
        expect(project(cam.viewProjection, 0, editorViewHalfHeight(view), 0).y).toBeCloseTo(1);
    });
});

describe('where the world axes point on screen', () => {
    it('is the 2D reading when the eye has not turned', () => {
        // Signed zero normalized, as in the head-on matrix above.
        const a = editorViewAxes(DEFAULT_EDITOR_VIEW);
        const cells = (s: { dx: number; dy: number; depth: number }) => [s.dx + 0, s.dy + 0, s.depth + 0];
        expect(cells(a.x)).toEqual([1, 0, 0]);   // right
        expect(cells(a.y)).toEqual([0, -1, 0]);  // up (screen y is down)
        expect(cells(a.z)).toEqual([0, 0, 1]);   // straight at the eye
    });

    it('agrees with where the camera actually projects those axes', () => {
        // The whole point of reading the indicator off the view basis: disagreeing
        // with the rendered frame would point users the wrong way. One scale factor
        // for all three asserts foreshortening too — an axis leaning at the eye is SHORT.
        const view = { ...DEFAULT_EDITOR_VIEW, active: true, yaw: 37, pitch: 21 };
        const cam = editorCameraInfo(view, 256, 256, []);
        const o = project(cam.viewProjection, view.x, view.y, 0);
        const axes = editorViewAxes(view);
        const shift = (d: readonly number[]) => {
            const p = project(cam.viewProjection, view.x + d[0]! * 50, view.y + d[1]! * 50, d[2]! * 50);
            // NDC y is up, screen y is down — the sign the indicator has to carry.
            return { x: p.x - o.x, y: -(p.y - o.y) };
        };
        const first = shift([1, 0, 0]);
        const k = Math.hypot(first.x, first.y) / Math.hypot(axes.x.dx, axes.x.dy);
        for (const [name, d] of [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]] as const) {
            const s = shift(d);
            expect(s.x).toBeCloseTo(axes[name].dx * k, 6);
            expect(s.y).toBeCloseTo(axes[name].dy * k, 6);
        }
    });

    it('stands the eye on the axis it was asked for, poles included', () => {
        for (const axis of ['x', 'y', 'z'] as const) {
            for (const sign of [1, -1] as const) {
                const a = editorViewAxisAngles(axis, sign);
                const axes = editorViewAxes({ ...DEFAULT_EDITOR_VIEW, ...a });
                // The chosen axis comes straight at the eye; the other two are flat
                // across the screen, which is what "a square-on view" means.
                expect(axes[axis].depth).toBeCloseTo(sign, 5);
                for (const other of (['x', 'y', 'z'] as const).filter(k => k !== axis)) {
                    expect(axes[other].depth).toBeCloseTo(0, 5);
                }
            }
        }
    });
});
