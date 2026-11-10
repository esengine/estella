// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rigRebind.ts
 * @brief   Changing which bone is which after a rig is bound: a new parent, a whole skeleton from another rig, and what the paths a clip names become.
 *
 * @details A bone has three names. Its index is what a vertex follows and what joint of the mesh it is, and it moves whenever the list is
 *          reordered. Its path (`upper/lower`) is what a clip names it by, and it moves when it or a bone above it is renamed or reparented.
 *          Its `id` never moves: it is what the prefab names the bone's entity by, so what a scene added to one bone (an IK2D, a sword) stays
 *          on that bone through every edit here. Every function in this file keeps vertices where they are in rig space: rebinding
 *          changes what follows what, never what the character looks like at rest.
 */
import { ensureRigBoneIds, rigBoneId, rigBoneWorlds, type RigBone, type RigSource } from './rigSource';

/** Each bone's path, as a clip names it below the rig's root. @experimental */
export function rigBonePaths(bones: readonly RigBone[]): string[] {
    const out: string[] = [];
    bones.forEach((b, i) => { out[i] = b.parent >= 0 && b.parent < i ? `${out[b.parent]}/${b.name}` : b.name; });
    return out;
}

/** Whether `bone` is `ancestor` or below it. */
function isUnder(bones: readonly RigBone[], bone: number, ancestor: number): boolean {
    for (let at = bone; at >= 0; at = bones[at]!.parent) if (at === ancestor) return true;
    return false;
}

/** Reorders bones so every parent comes first, keeping the order otherwise; `order[newIndex] = oldIndex`. */
function parentsFirst(bones: readonly RigBone[]): number[] {
    const order: number[] = [], placed = new Set<number>();
    const place = (i: number): void => {
        if (placed.has(i)) return;
        const parent = bones[i]!.parent;
        if (parent >= 0) place(parent);
        placed.add(i);
        order.push(i);
    };
    bones.forEach((_, i) => place(i));
    return order;
}

/** Puts the bones in `order` (`order[newIndex] = oldIndex`), carrying parents and every vertex's weights along. */
function reorderBones(rig: RigSource, order: readonly number[]): void {
    const newIndexOf = new Map(order.map((old, i) => [old, i]));
    const at = (old: number): number => newIndexOf.get(old)!;
    rig.bones = order.map((old) => {
        const b = rig.bones[old]!;
        return { ...b, parent: b.parent >= 0 ? at(b.parent) : -1 };
    });
    for (const part of rig.parts) {
        part.weights = part.weights.map((w) => w.map((v, i) => (i % 2 === 0 ? at(v) : v)));
    }
}

/** Why a bone cannot take this parent, or null when it can. @experimental */
export function rigParentProblem(rig: RigSource, index: number, parent: number): string | null {
    if (!rig.bones[index]) return 'there is no such bone';
    if (parent < -1 || parent >= rig.bones.length) return 'there is no such parent';
    if (parent >= 0 && isUnder(rig.bones, parent, index)) return parent === index ? 'a bone cannot be its own parent' : 'that bone hangs below this one';
    return null;
}

/**
 * Hangs a bone (and everything below it) off another, or makes it a root with -1, where it stands now: its place and rotation are
 * re-expressed in the new parent's space, so nothing moves at rest. The list is reordered when the new parent came after it, and the
 * weights with it; ids stay, so the scene keeps what it added to each bone. Returns the bone's index afterwards.
 * Throws on a parent {@link rigParentProblem} refuses.
 * @experimental
 */
export function setRigBoneParent(rig: RigSource, index: number, parent: number): number {
    const problem = rigParentProblem(rig, index, parent);
    if (problem) throw new Error(`cannot reparent: ${problem}`);
    ensureRigBoneIds(rig);
    const bone = rig.bones[index]!;
    if (bone.parent === parent) return index;
    const worlds = rigBoneWorlds(rig.bones), w = worlds[index]!;
    const up = parent >= 0 ? worlds[parent]! : { x: 0, y: 0, rotation: 0 };
    const c = Math.cos(up.rotation), s = Math.sin(up.rotation), dx = w.x - up.x, dy = w.y - up.y;
    bone.x = c * dx + s * dy;
    bone.y = -s * dx + c * dy;
    bone.rotation = w.rotation - up.rotation;
    bone.parent = parent;
    const id = bone.id!;
    reorderBones(rig, parentsFirst(rig.bones));
    return rig.bones.findIndex(b => b.id === id);
}

/** What {@link rebindRigToSkeleton} did, bone by bone of the rig as it was. @experimental */
export interface RigRebindReport {
    /** Old bone names that found a bone of the same name. */
    matched: string[];
    /** Old bone names that did not, and the new bone their vertices went to. */
    moved: { from: string; to: string }[];
}

/**
 * Binds the rig to another skeleton, a list of bones as a `.esrig` holds them, matched by name. The rig's bones become a copy of
 * `skeleton`, ids included, so two rigs bound to one skeleton have entities of the same ids and names and play the same clips.
 * A vertex keeps its weights on every bone that found its namesake. A bone that did not hands them to its nearest ancestor that did,
 * or, with none, to the new bone whose head is closest to its own. Vertices stay where they are in rig space; what moves is the bind
 * pose, so the skin rests where it did against whatever pose the new skeleton rests in.
 * @experimental
 */
export function rebindRigToSkeleton(rig: RigSource, skeleton: readonly RigBone[]): RigRebindReport {
    if (skeleton.length === 0) throw new Error('cannot rebind: the skeleton has no bones');
    const next = skeleton.map(b => ({ ...b }));
    const nextRig: RigSource = { ...rig, bones: next, parts: [] };
    ensureRigBoneIds(nextRig);
    const byName = new Map(next.map((b, i) => [b.name, i]));
    const oldWorlds = rigBoneWorlds(rig.bones), newWorlds = rigBoneWorlds(next);
    const report: RigRebindReport = { matched: [], moved: [] };
    const target = rig.bones.map((b, i) => {
        const same = byName.get(b.name);
        if (same !== undefined) { report.matched.push(b.name); return same; }
        let to = -1;
        for (let up = b.parent; up >= 0 && to < 0; up = rig.bones[up]!.parent) to = byName.get(rig.bones[up]!.name) ?? -1;
        if (to < 0) {
            const at = oldWorlds[i]!;
            let best = Infinity;
            newWorlds.forEach((w, j) => {
                const d = Math.hypot(w.x - at.x, w.y - at.y);
                if (d < best) { best = d; to = j; }
            });
        }
        report.moved.push({ from: b.name, to: next[to]!.name });
        return to;
    });
    for (const part of rig.parts) {
        part.weights = part.weights.map((w) => {
            const merged = new Map<number, number>();
            for (let i = 0; i < w.length; i += 2) {
                const bone = target[w[i]!]!;
                merged.set(bone, (merged.get(bone) ?? 0) + w[i + 1]!);
            }
            return [...merged].flat();
        });
    }
    rig.bones = next;
    return report;
}

/** How the paths a clip names changed between two saves of one rig, by bone id. @experimental */
export interface RigPathChanges {
    /** Old path to new, for every bone still there whose path is not what it was. */
    renamed: Map<string, string>;
    /** Paths of bones that are gone. */
    removed: string[];
    /** Every path the rig had before: what a clip must name to be one of this rig's. */
    before: Set<string>;
}

/** Compares two saves of a rig. Bones without ids are matched by index, which is what they were saved as. @experimental */
export function rigPathChanges(before: readonly RigBone[], after: readonly RigBone[]): RigPathChanges {
    const oldPaths = rigBonePaths(before), newPaths = rigBonePaths(after);
    const newById = new Map(after.map((_, i) => [rigBoneId(after, i), newPaths[i]!]));
    const renamed = new Map<string, string>(), removed: string[] = [];
    before.forEach((_, i) => {
        const now = newById.get(rigBoneId(before, i));
        if (now === undefined) removed.push(oldPaths[i]!);
        else if (now !== oldPaths[i]) renamed.set(oldPaths[i]!, now);
    });
    return { renamed, removed, before: new Set(oldPaths) };
}

/**
 * Where a path named before the change points now. A path below a bone (a sword parented to `arm` in the scene, `arm/sword`) follows the
 * deepest bone it starts with. Null when that bone is gone; the path itself when nothing it starts with changed.
 * @experimental
 */
export function remapRigPath(path: string, changes: RigPathChanges): string | null {
    if (!path) return path;
    const parts = path.split('/');
    for (let n = parts.length; n > 0; n--) {
        const head = parts.slice(0, n).join('/');
        if (!changes.before.has(head)) continue;
        if (changes.removed.includes(head)) return null;
        const now = changes.renamed.get(head);
        return now === undefined ? path : [now, ...parts.slice(n)].join('/');
    }
    return path;
}
