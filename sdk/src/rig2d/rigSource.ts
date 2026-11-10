// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rigSource.ts
 * @brief   `.esrig`: a 2D character as it is authored. Parts cut from an image, the bones under them, what each vertex follows.
 *
 * @details The file a person edits; the `.esmesh` baked from it is what a scene draws, so a built game carries no rig code unless
 *          it uses constraints. Bones in a scene are ordinary entities, which is what lets clips, the animator and masks reach them.
 *          Rig space is world units, y up. Part vertices stay in image pixels, y down, so a part keeps its shape when it is moved.
 *          A parent always comes before its children in `bones`: every walk over them relies on it.
 */

export const RIG_SOURCE_VERSION = 1;
export const RIG_SOURCE_EXT = '.esrig';
/** A vertex follows at most this many bones: what the mesh format's joint channel holds. */
export const RIG_MAX_INFLUENCES = 4;

/** @experimental */
export interface RigBone {
    name: string;
    /** Index of the parent bone, -1 for a root. */
    parent: number;
    /** Where it starts in its parent's space (rig space for a root). */
    x: number;
    y: number;
    /** Radians, counter-clockwise, in its parent's space. */
    rotation: number;
    /** How far it reaches along its own +x. Draws the bone, aims an IK chain, and shapes automatic weights. */
    length: number;
    /**
     * What the prefab names this bone's entity by, so what a scene adds to it stays on it when bones are reordered, removed or reparented.
     * Missing on a rig saved before there were ids, which is read as `b<index>`, the name those prefabs used. See {@link ensureRigBoneIds}.
     */
    id?: string;
}

/** @experimental */
export interface RigPart {
    name: string;
    /** The piece of the image, in pixels from its top left. */
    rect: { x: number; y: number; w: number; h: number };
    /** Where the rect's top left sits in rig space. */
    x: number;
    y: number;
    /** Flat `[x, y, ...]`, in pixels from the rect's top left, y down. */
    vertices: number[];
    /** Flat vertex indices, three a triangle. */
    triangles: number[];
    /** Per vertex, flat `[bone, weight, ...]`, at most {@link RIG_MAX_INFLUENCES} pairs summing to 1. Empty until it is bound, which only a bake refuses. */
    weights: number[][];
}

/** A shape the mesh can blend towards. `offsets` is by part name, flat `[vertex, dx, dy, ...]` in rig units, y up. @experimental */
export interface RigDeform {
    name: string;
    offsets: Record<string, number[]>;
}

/** @experimental */
export interface RigSource {
    version: number;
    /** The image the parts are cut from. */
    texture: string;
    textureWidth: number;
    textureHeight: number;
    /** World units one image pixel covers. */
    unitsPerPixel: number;
    bones: RigBone[];
    /** In draw order, first at the back: they are one mesh, drawn in index order. */
    parts: RigPart[];
    deforms: RigDeform[];
}

/** @experimental */
export function createRig(texture: string, textureWidth: number, textureHeight: number, unitsPerPixel = 1): RigSource {
    return { version: RIG_SOURCE_VERSION, texture, textureWidth, textureHeight, unitsPerPixel, bones: [], parts: [], deforms: [] };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const flat = (v: unknown): v is number[] => Array.isArray(v) && v.every(finite);

/** Every way a rig is not a rig, as sentences. A rig still being made passes: no bones, and vertices that follow nothing yet. @experimental */
export function checkRig(rig: RigSource): string[] {
    const out: string[] = [];
    if (rig?.version !== RIG_SOURCE_VERSION) return [`version ${String(rig?.version)} is not one this engine reads (${RIG_SOURCE_VERSION})`];
    if (typeof rig.texture !== 'string') out.push('texture is not a path');
    if (!(rig.textureWidth > 0) || !(rig.textureHeight > 0)) out.push('the image size is missing');
    if (!(rig.unitsPerPixel > 0)) out.push('unitsPerPixel must be above 0');
    if (!Array.isArray(rig.bones) || !Array.isArray(rig.parts) || !Array.isArray(rig.deforms)) return [...out, 'bones, parts and deforms must be lists'];
    const boneNames = new Set<string>(), boneIds = new Set<string>();
    rig.bones.forEach((b, i) => {
        if (typeof b?.name !== 'string' || b.name === '') out.push(`bone ${i} has no name`);
        else if (boneNames.has(b.name)) out.push(`two bones are called "${b.name}": a clip names a bone by its path, so the second could not be reached`);
        else boneNames.add(b.name);
        if (b?.id !== undefined && (typeof b.id !== 'string' || b.id === '')) out.push(`bone "${b?.name}" has a bad id`);
        else if (b?.id !== undefined && boneIds.has(b.id)) out.push(`two bones have the id "${b.id}": a scene could not tell their entities apart`);
        else if (b?.id !== undefined) boneIds.add(b.id);
        if (!Number.isInteger(b?.parent) || b.parent < -1 || b.parent >= i) out.push(`bone "${b?.name}" must name a parent earlier in the list`);
        if (![b?.x, b?.y, b?.rotation, b?.length].every(finite) || b.length < 0) out.push(`bone "${b?.name}" has a bad position, rotation or length`);
    });
    const partNames = new Set<string>();
    rig.parts.forEach((p) => {
        const label = `part "${p?.name}"`;
        if (typeof p?.name !== 'string' || p.name === '' || partNames.has(p.name)) out.push(`${label} needs a name of its own`);
        else partNames.add(p.name);
        if (![p?.rect?.x, p?.rect?.y, p?.rect?.w, p?.rect?.h, p?.x, p?.y].every(finite)) { out.push(`${label} has a bad rect or position`); return; }
        if (!flat(p.vertices) || p.vertices.length % 2 !== 0) { out.push(`${label} has bad vertices`); return; }
        const count = p.vertices.length / 2;
        if (!flat(p.triangles) || p.triangles.length % 3 !== 0 || p.triangles.some(t => !Number.isInteger(t) || t < 0 || t >= count)) out.push(`${label} has bad triangles`);
        if (!Array.isArray(p.weights) || p.weights.length !== count) { out.push(`${label} needs one weight list per vertex`); return; }
        p.weights.forEach((w, v) => {
            if (!flat(w) || w.length % 2 !== 0 || w.length > RIG_MAX_INFLUENCES * 2) { out.push(`${label} vertex ${v} has bad weights`); return; }
            for (let i = 0; i < w.length; i += 2) {
                if (!Number.isInteger(w[i]) || w[i]! < 0 || w[i]! >= rig.bones.length) { out.push(`${label} vertex ${v} follows a bone that is not there`); return; }
            }
        });
    });
    rig.deforms.forEach((d) => {
        if (typeof d?.name !== 'string' || d.name === '') out.push('a deform has no name');
        for (const [part, offsets] of Object.entries(d?.offsets ?? {})) {
            const owner = rig.parts.find(p => p.name === part);
            if (!owner) { out.push(`deform "${d.name}" moves a part that is not there: "${part}"`); continue; }
            if (!flat(offsets) || offsets.length % 3 !== 0) { out.push(`deform "${d.name}" has bad offsets for "${part}"`); continue; }
            for (let i = 0; i < offsets.length; i += 3) {
                if (!Number.isInteger(offsets[i]) || offsets[i]! < 0 || offsets[i]! >= owner.vertices.length / 2) { out.push(`deform "${d.name}" moves a vertex "${part}" does not have`); break; }
            }
        }
    });
    return out;
}

/** Reads a `.esrig`, refusing a damaged one: a silently repaired rig is a character that moves wrong later. @experimental */
export function parseRig(text: string): RigSource {
    const rig = JSON.parse(text) as RigSource;
    const problems = checkRig(rig);
    if (problems.length > 0) throw new Error(`this .esrig cannot be used: ${problems.join('; ')}`);
    return rig;
}

/** @experimental */
export function serializeRig(rig: RigSource): string {
    return `${JSON.stringify(rig, (_key, value) => (typeof value === 'number' && !Number.isInteger(value) ? Number(value.toFixed(5)) : value), 2)}\n`;
}

const ID_PATTERN = /^b(\d+)$/;

/** The id the prefab names bone `index`'s entity by. A bone with none is named by its index, which is what every rig saved before ids had. @experimental */
export function rigBoneId(bones: readonly RigBone[], index: number): string {
    return bones[index]?.id ?? `b${index}`;
}

/**
 * Gives every bone without an id one, without reusing one already given: a scene may still hold what it added to a removed bone's entity,
 * and a new bone must not inherit it. Call before anything reorders the list.
 * @experimental
 */
export function ensureRigBoneIds(rig: RigSource): void {
    // A rig with no ids yet is one saved before them: its bones keep the names its prefab already gave their entities.
    if (rig.bones.every(b => !b.id)) { rig.bones.forEach((b, i) => { b.id = `b${i}`; }); return; }
    let next = rig.bones.length;
    for (const b of rig.bones) next = Math.max(next, Number(ID_PATTERN.exec(b.id ?? '')?.[1] ?? -1) + 1);
    const used = new Set(rig.bones.flatMap(b => (b.id ? [b.id] : [])));
    for (const b of rig.bones) {
        if (b.id) continue;
        while (used.has(`b${next}`)) next++;
        b.id = `b${next++}`;
        used.add(b.id);
    }
}

/** A bone's place in rig space. @experimental */
export interface RigBoneWorld { x: number; y: number; rotation: number }

/** Every bone in rig space. `rotations` poses them, by bone index, in place of their bind rotations. @experimental */
export function rigBoneWorlds(bones: readonly RigBone[], rotations?: ArrayLike<number>): RigBoneWorld[] {
    const out: RigBoneWorld[] = [];
    bones.forEach((b, i) => {
        const local = rotations?.[i] ?? b.rotation;
        const parent = out[b.parent];
        if (!parent) { out.push({ x: b.x, y: b.y, rotation: local }); return; }
        const c = Math.cos(parent.rotation), s = Math.sin(parent.rotation);
        out.push({ x: parent.x + c * b.x - s * b.y, y: parent.y + s * b.x + c * b.y, rotation: parent.rotation + local });
    });
    return out;
}

/** Takes a bone out, giving its children to its parent where they stand, and its vertices to its parent or nearest survivor. @experimental */
export function removeRigBone(rig: RigSource, index: number): void {
    // The survivors move up the list, so they need names that do not.
    ensureRigBoneIds(rig);
    const worlds = rigBoneWorlds(rig.bones), gone = rig.bones[index];
    if (!gone) return;
    const heir = gone.parent >= 0 ? gone.parent : -1;
    const heirWorld = heir >= 0 ? worlds[heir]! : { x: 0, y: 0, rotation: 0 };
    rig.bones.forEach((b, i) => {
        if (b.parent !== index) return;
        const w = worlds[i]!, c = Math.cos(heirWorld.rotation), s = Math.sin(heirWorld.rotation);
        const dx = w.x - heirWorld.x, dy = w.y - heirWorld.y;
        b.x = c * dx + s * dy; b.y = -s * dx + c * dy;
        b.rotation = w.rotation - heirWorld.rotation; b.parent = heir;
    });
    rig.bones.splice(index, 1);
    for (const b of rig.bones) if (b.parent > index) b.parent--;
    const shift = (bone: number): number => (bone > index ? bone - 1 : bone);
    const fallback = heir >= 0 ? heir : 0;
    for (const part of rig.parts) {
        part.weights = part.weights.map((w) => {
            const merged = new Map<number, number>();
            for (let i = 0; i < w.length; i += 2) {
                const bone = w[i] === index ? fallback : shift(w[i]!);
                merged.set(bone, (merged.get(bone) ?? 0) + w[i + 1]!);
            }
            return [...merged].flat();
        });
        if (rig.bones.length === 0) part.weights = part.weights.map(() => []);
    }
}
