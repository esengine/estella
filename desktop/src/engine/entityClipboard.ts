// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    entityClipboard.ts
 * @brief   Entity copy/cut/paste clipboard — holds a forest of entity subtrees and
 *          re-keys them on paste. Distinct from the tilemap clipboard (tiles).
 *
 * The clipboard stores a deep-cloned snapshot of the copied subtrees (the model's
 * lossless SceneEntity records, so unknown components + `@uuid:` refs survive),
 * detached from live source ids. Paste re-keys every entity to fresh ids, remaps
 * internal parent/child links, and reparents the roots — so paste works repeatedly,
 * across scenes, and after the originals are deleted.
 */
import type { SceneData } from 'esengine';
import type { EntityId } from '@/types';

type SceneEntity = SceneData['entities'][number];

let clipboard: SceneEntity[] | null = null;

/** Replace the clipboard with a deep-cloned snapshot (or clear it if empty). */
export function setEntityClipboard(entities: readonly SceneEntity[]): void {
    clipboard = entities.length ? entities.map((e) => structuredClone(e)) : null;
}

export function getEntityClipboard(): SceneEntity[] | null {
    return clipboard;
}

export function hasEntityClipboard(): boolean {
    return clipboard != null && clipboard.length > 0;
}

/**
 * Re-key a clipboard forest with fresh ids. Links that point inside the set are
 * remapped to the new ids; an entity whose parent is outside the set is a root —
 * it is reparented to `rootParent` and its Transform offset by `offset` (so a
 * paste lands visibly clear of the original). Pure: input is not mutated; new ids
 * come from `allocId`. Returns the re-keyed entities plus the new root ids.
 */
export function remapClipboardEntities(
    payload: readonly SceneEntity[],
    allocId: () => number,
    rootParent: EntityId | null,
    offset: { x: number; y: number },
): { entities: SceneEntity[]; rootIds: EntityId[] } {
    const ids = new Set<EntityId>(payload.map((e) => (e as { id: EntityId }).id));
    const idMap = new Map<EntityId, EntityId>();
    for (const e of payload) idMap.set((e as { id: EntityId }).id, allocId());

    const rootIds: EntityId[] = [];
    const entities = payload.map((e) => {
        const src = e as SceneEntity & { id: EntityId; parent: EntityId | null; children?: EntityId[] };
        const isRoot = src.parent == null || !ids.has(src.parent);
        const clone = structuredClone(src) as SceneEntity & { id: EntityId; parent: EntityId | null; children?: EntityId[] };
        clone.id = idMap.get(src.id)!;
        clone.parent = isRoot ? rootParent : idMap.get(src.parent!)!;
        clone.children = (src.children ?? []).filter((c) => ids.has(c)).map((c) => idMap.get(c)!);
        if (isRoot) {
            rootIds.push(clone.id);
            const pos = (clone.components.find((c) => c.type === 'Transform')?.data as
                | { position?: { x: number; y: number } }
                | undefined)?.position;
            if (pos) { pos.x += offset.x; pos.y += offset.y; }
        }
        return clone;
    });
    return { entities, rootIds };
}
