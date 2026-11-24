// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Six square images → the panorama an environment import takes.
 *
 * A skybox set is the other common way artists hand over a sky. The engine loads no
 * cube map, so the six faces are resampled into one equirectangular panorama and
 * then go through the same import as a `.hdr`: one atlas, nine coefficients, and a
 * sky drawn from the panorama.
 *
 * Each face is read as a viewer standing inside the box sees it — facing +Z, right
 * is -X, which is also how `panoramaDirection` reads a panorama — so a face with
 * text on it shows the text unmirrored. A set authored with another convention is
 * fixed per face with `rotate` and `flip`, never by editing the images.
 */
import type { Panorama } from './environmentImport';
import { SRGB_TO_LINEAR } from './ldrPanorama';

export const CUBE_FACE_NAMES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const;
export type CubeFaceName = typeof CUBE_FACE_NAMES[number];

/** The axis each face looks along, for messages an author reads. */
export const CUBE_FACE_LABELS: Record<CubeFaceName, string> = {
    px: '+X', nx: '-X', py: '+Y', ny: '-Y', pz: '+Z', nz: '-Z',
};

/** The widest face an import takes: six of them at this size are 6 x 4096² x 4 bytes. */
export const CUBE_MAX_FACE = 4096;

export interface CubeFace {
    width: number;
    height: number;
    /** RGBA8, row 0 = top. */
    rgba: Uint8Array;
    /** Turn the image clockwise by this many degrees. Default 0. */
    rotate?: 0 | 90 | 180 | 270;
    /** Mirror the image left to right, before it is turned. */
    flip?: boolean;
}

export type CubeFaceSet = Partial<Record<CubeFaceName, CubeFace>>;

/** A face set that cannot be imported, naming the face it is about when it has one. */
export class CubeImportError extends Error {
    constructor(message: string, readonly face?: CubeFaceName) {
        super(message);
        this.name = 'CubeImportError';
    }
}

/** Check a set is six matching squares. Never fills a face in: a black face would
 *  import cleanly and light the scene wrongly. */
export function validateCubeFaces(faces: CubeFaceSet): void {
    const missing = CUBE_FACE_NAMES.filter((n) => !faces[n]);
    if (missing.length > 0) {
        throw new CubeImportError(`missing face${missing.length > 1 ? 's' : ''} ${missing.map((n) => CUBE_FACE_LABELS[n]).join(', ')}`,
            missing[0]);
    }
    for (const n of CUBE_FACE_NAMES) {
        const f = faces[n]!;
        if (f.width !== f.height) {
            throw new CubeImportError(`face ${CUBE_FACE_LABELS[n]} is ${f.width}x${f.height}, not square`, n);
        }
        if (f.width < 1 || f.width > CUBE_MAX_FACE) {
            throw new CubeImportError(`face ${CUBE_FACE_LABELS[n]} is ${f.width}px wide; faces must be 1 to ${CUBE_MAX_FACE}`, n);
        }
        if (f.rgba.length !== f.width * f.height * 4) {
            throw new CubeImportError(`face ${CUBE_FACE_LABELS[n]} holds ${f.rgba.length} bytes, not ${f.width * f.height * 4}`, n);
        }
    }
    const size = faces.px!.width;
    for (const n of CUBE_FACE_NAMES) {
        if (faces[n]!.width !== size) {
            throw new CubeImportError(`face ${CUBE_FACE_LABELS[n]} is ${faces[n]!.width}px but +X is ${size}px; all six must match`, n);
        }
    }
}

/** A direction → the face it leaves through and where on it, in [0, 1]² of the face as
 *  seen from inside, before any rotate or flip. */
function faceOf(x: number, y: number, z: number): { face: CubeFaceName; a: number; b: number } {
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    let face: CubeFaceName, sc: number, tc: number, ma: number;
    if (ax >= ay && ax >= az) {
        ma = ax;
        if (x > 0) {
            face = 'px';
            sc = z;
            tc = -y;
        } else {
            face = 'nx';
            sc = -z;
            tc = -y;
        }
    } else if (ay >= az) {
        ma = ay;
        if (y > 0) {
            face = 'py';
            sc = x;
            tc = z;
        } else {
            face = 'ny';
            sc = -x;
            tc = -z;
        }
    } else {
        ma = az;
        if (z > 0) {
            face = 'pz';
            sc = -x;
            tc = -y;
        } else {
            face = 'nz';
            sc = x;
            tc = -y;
        }
    }
    return { face, a: (sc / ma + 1) / 2, b: (tc / ma + 1) / 2 };
}

/** Where the displayed point (a, b) sits in the source image, once the face's own
 *  rotate and flip are undone. */
function sourcePoint(face: CubeFace, a: number, b: number): [number, number] {
    let x: number, y: number;
    switch (face.rotate ?? 0) {
        case 90: x = b; y = 1 - a; break;
        case 180: x = 1 - a; y = 1 - b; break;
        case 270: x = 1 - b; y = a; break;
        default: x = a; y = b;
    }
    return [face.flip ? 1 - x : x, y];
}

/**
 * Resample six faces into a linear equirectangular panorama, 4n by 2n for faces of n.
 *
 * @param colorSpace How the 8-bit faces are encoded. `srgb` is what a PNG or JPEG is,
 *        and is linearized; this is a low-dynamic-range source, so nothing here
 *        brightens it past 1 — a sun in a JPEG is as bright as white.
 */
export function cubeFacesToPanorama(faces: CubeFaceSet, colorSpace: 'srgb' | 'linear' = 'srgb'): Panorama {
    validateCubeFaces(faces);
    const n = faces.px!.width;
    const width = n * 4, height = n * 2;
    const rgb = new Float32Array(width * height * 3);
    const lut = colorSpace === 'srgb' ? SRGB_TO_LINEAR : null;
    const read = (f: CubeFace, ix: number, iy: number, c: number): number => {
        const cx = Math.max(0, Math.min(n - 1, ix)), cy = Math.max(0, Math.min(n - 1, iy));
        const v = f.rgba[(cy * n + cx) * 4 + c]!;
        return lut ? lut[v]! : v / 255;
    };
    for (let y = 0; y < height; y++) {
        const v = (y + 0.5) / height;
        const theta = v * Math.PI;
        const s = Math.sin(theta), cy = Math.cos(theta);
        for (let x = 0; x < width; x++) {
            const phi = ((x + 0.5) / width - 0.5) * 2 * Math.PI;
            const dx = -s * Math.sin(phi), dz = s * Math.cos(phi);
            const hit = faceOf(dx, cy, dz);
            const face = faces[hit.face]!;
            const [u, w] = sourcePoint(face, hit.a, hit.b);
            const fx = u * n - 0.5, fy = w * n - 0.5;
            const x0 = Math.floor(fx), y0 = Math.floor(fy);
            const tx = fx - x0, ty = fy - y0;
            const o = (y * width + x) * 3;
            for (let c = 0; c < 3; c++) {
                const top = read(face, x0, y0, c) * (1 - tx) + read(face, x0 + 1, y0, c) * tx;
                const bottom = read(face, x0, y0 + 1, c) * (1 - tx) + read(face, x0 + 1, y0 + 1, c) * tx;
                rgb[o + c] = top * (1 - ty) + bottom * ty;
            }
        }
    }
    return { width, height, rgb };
}

/** The version of the `.escube` document. */
export const CUBE_SOURCE_VERSION = 1;

/**
 * An environment's source made of six images — the `.escube` file, a sibling of `.hdr` as a
 * source: importing it produces the same `.esenv`, atlas and sky. The images are named, not
 * embedded, so replacing one is a re-import, and what the author chose about each face
 * (its turn, its mirroring) is part of the source rather than of a dialog's memory.
 */
export interface CubeSourceDocument {
    version: typeof CUBE_SOURCE_VERSION;
    /** How the images are encoded. PNG and JPEG are sRGB, the default. */
    colorSpace?: 'srgb' | 'linear';
    faces: Partial<Record<CubeFaceName, { file: string; rotate?: 0 | 90 | 180 | 270; flip?: boolean }>>;
    /**
     * Instead of six faces, one equirectangular picture (PNG or JPEG). The source is then a
     * low-dynamic-range panorama: it needs a colour space chosen, and it is not a recovered
     * HDR — nothing in it is brighter than white. `faces` is empty beside it.
     */
    panorama?: { file: string };
}

/** Read a `.escube` document, refusing what it cannot mean. A face left out is allowed here:
 *  an unfinished set is a document, and the import names what is missing. */
export function parseCubeSource(raw: unknown): CubeSourceDocument {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new CubeImportError('a cube source is a JSON object');
    }
    const doc = raw as Record<string, unknown>;
    if (doc.version !== CUBE_SOURCE_VERSION) {
        throw new CubeImportError(`cube source version ${String(doc.version)} is not the ${CUBE_SOURCE_VERSION} this editor reads`);
    }
    if (doc.colorSpace !== undefined && doc.colorSpace !== 'srgb' && doc.colorSpace !== 'linear') {
        throw new CubeImportError(`colorSpace must be "srgb" or "linear", not ${JSON.stringify(doc.colorSpace)}`);
    }
    let panorama: { file: string } | undefined;
    if (doc.panorama !== undefined) {
        const p = doc.panorama as Record<string, unknown> | null;
        if (typeof p !== 'object' || p === null || typeof p.file !== 'string' || p.file === '') {
            throw new CubeImportError('a panorama image needs the "file" it reads');
        }
        if (doc.faces !== undefined && (typeof doc.faces !== 'object' || doc.faces === null
            || Array.isArray(doc.faces) || Object.keys(doc.faces).length > 0)) {
            throw new CubeImportError('a source is six faces or one panorama image, not both');
        }
        panorama = { file: p.file };
    } else if (typeof doc.faces !== 'object' || doc.faces === null || Array.isArray(doc.faces)) {
        throw new CubeImportError('a cube source names its images under "faces"');
    }
    const faces: CubeSourceDocument['faces'] = {};
    for (const [key, value] of Object.entries(panorama ? {} : doc.faces as Record<string, unknown>)) {
        const name = (CUBE_FACE_NAMES as readonly string[]).includes(key) ? key as CubeFaceName : null;
        if (!name) {
            throw new CubeImportError(`"${key}" is not a face; the faces are ${CUBE_FACE_NAMES.join(', ')}`);
        }
        const f = value as Record<string, unknown> | null;
        if (typeof f !== 'object' || f === null || typeof f.file !== 'string' || f.file === '') {
            throw new CubeImportError(`face ${CUBE_FACE_LABELS[name]} needs the "file" it reads`, name);
        }
        if (f.rotate !== undefined && f.rotate !== 0 && f.rotate !== 90 && f.rotate !== 180 && f.rotate !== 270) {
            throw new CubeImportError(`face ${CUBE_FACE_LABELS[name]}: rotate is 0, 90, 180 or 270, not ${JSON.stringify(f.rotate)}`, name);
        }
        if (f.flip !== undefined && typeof f.flip !== 'boolean') {
            throw new CubeImportError(`face ${CUBE_FACE_LABELS[name]}: flip is true or false`, name);
        }
        faces[name] = { file: f.file, ...(f.rotate !== undefined ? { rotate: f.rotate } : {}),
                        ...(f.flip !== undefined ? { flip: f.flip } : {}) };
    }
    return { version: CUBE_SOURCE_VERSION, ...(doc.colorSpace ? { colorSpace: doc.colorSpace } : {}), faces,
             ...(panorama ? { panorama } : {}) };
}
