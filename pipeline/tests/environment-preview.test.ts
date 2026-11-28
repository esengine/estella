// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * What an environment looks like without a scene: the sky as a picture, a matte sphere and a
 * mirror — turned by the rotation the way the frame and the bake turn the environment, so
 * "which way does this sky face" is answered in the engine's own convention.
 */
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { panoramaDirection } from 'esengine';
import { importEnvironmentFromPanorama, ENV_MAX_RANGE, type Panorama } from '../src/assets/environmentImport';
import { previewBall, previewPanorama, type EnvironmentPreviewInput } from '../src/assets/environmentPreview';

/** A sky of six flat colours, one per axis, so a preview pixel names the direction it saw. */
function axisSky(): Panorama {
    const width = 128, height = 64, rgb = new Float32Array(width * height * 3);
    const colors: Record<string, [number, number, number]> = {
        px: [4, 0, 0], nx: [1, 0, 0], py: [0, 4, 0], ny: [0, 1, 0], pz: [0, 0, 4], nz: [2, 2, 0],
    };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [dx, dy, dz] = panoramaDirection((x + 0.5) / width, (y + 0.5) / height);
            const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
            const key = ax >= ay && ax >= az ? (dx > 0 ? 'px' : 'nx') : ay >= az ? (dy > 0 ? 'py' : 'ny') : (dz > 0 ? 'pz' : 'nz');
            rgb.set(colors[key]!, (y * width + x) * 3);
        }
    }
    return { width, height, rgb };
}

function inputOf(rotationDeg = 0, withSky = true): EnvironmentPreviewInput {
    const made = importEnvironmentFromPanorama(axisSky(), 't', { faceSize: 16, skyWidth: 128 });
    const png = PNG.sync.read(Buffer.from(made.sky!.bytes));
    return {
        irradiance: made.document.irradiance,
        sky: withSky ? { width: png.width, height: png.height, rgba: new Uint8Array(png.data) } : null,
        maxRange: ENV_MAX_RANGE, rotationDeg,
    };
}

const SIZE = 33;
const at = (img: { width: number; rgba: Uint8Array }, x: number, y: number): number[] =>
    [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];
const dominant = (c: number[]): 'r' | 'g' | 'b' | 'y' => {
    const [r, g, b] = c as [number, number, number];
    if (r > 100 && g > 100 && b < 100) return 'y';
    return r >= g && r >= b ? 'r' : g >= b ? 'g' : 'b';
};

describe('the mirror sphere', () => {
    it('shows what faces the viewer — +Z — at its centre', () => {
        const ball = previewBall(inputOf(), 'mirror', SIZE);
        expect(dominant(at(ball, 16, 16))).toBe('b');
    });

    it('shows what is behind it, -Z, at its rim', () => {
        const ball = previewBall(inputOf(), 'mirror', SIZE);
        // Just inside the rim, the reflected ray turns almost straight back.
        expect(dominant(at(ball, 16, 1))).not.toBe('b');
    });

    it('turns the sky with the rotation: after 90 degrees the centre shows the environment\'s +X', () => {
        expect(dominant(at(previewBall(inputOf(90), 'mirror', SIZE), 16, 16))).toBe('r');
        expect(dominant(at(previewBall(inputOf(0), 'mirror', SIZE), 16, 16))).toBe('b');
    });

    it('is transparent outside the sphere', () => {
        expect(at(previewBall(inputOf(), 'mirror', SIZE), 0, 0)[3]).toBe(0);
    });

    it('falls back to the irradiance when the import wrote no sky image', () => {
        const ball = previewBall(inputOf(0, false), 'mirror', SIZE);
        expect(at(ball, 16, 16)[3]).toBe(255);
    });
});

describe('the matte sphere', () => {
    it('is lit more from the side the sky is brighter on', () => {
        // +Y is a strong green and -Y a weak one, so the top of the ball is greener than the bottom.
        const ball = previewBall(inputOf(), 'diffuse', SIZE);
        expect(at(ball, 16, 4)[1]!).toBeGreaterThan(at(ball, 16, 28)[1]!);
    });
});

describe('the sky picture', () => {
    it('puts +Z at the centre, and turns it with the rotation', () => {
        const flat = previewPanorama(inputOf(0), 64);
        expect(flat.height).toBe(32);
        expect(dominant(at(flat, 32, 16))).toBe('b');
        // Turned 90 degrees, the centre of the picture is the same direction the ball's centre shows.
        expect(dominant(at(previewPanorama(inputOf(90), 64), 32, 16))).toBe('r');
    });

    it('is as bright as exposure makes it', () => {
        const dim = previewPanorama({ ...inputOf(0), exposure: 0.1 }, 64);
        const full = previewPanorama(inputOf(0), 64);
        expect(at(dim, 32, 16)[2]!).toBeLessThan(at(full, 32, 16)[2]!);
    });

    it('wraps a quarter turn through the panorama seam without changing latitude', () => {
        const input = inputOf(0);
        const unturned = previewPanorama(input, 64);
        const turned = previewPanorama({ ...input, rotationDeg: 90 }, 64);
        for (let y = 0; y < turned.height; y++) {
            for (let x = 0; x < turned.width; x++) {
                expect(at(turned, x, y)).toEqual(at(unturned, (x + 48) % 64, y));
            }
        }
    });
});
