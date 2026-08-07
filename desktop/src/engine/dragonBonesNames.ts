// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    dragonBonesNames.ts
 * @brief   Fills the armature and animation dropdowns from the file the entity
 *          points at.
 *
 * @details An enum-option provider answers synchronously and reading a file does
 *          not, so this is a cache the provider reads and a warm that fills it.
 *          A cold miss returns nothing, which the inspector already treats as
 *          "leave the field plainly editable" — so the field works before the read
 *          lands and improves after it, instead of stranding the value in an empty
 *          dropdown. A landed read POKES the panels: nothing else changes when a
 *          background read finishes, so without it the inspector kept rendering the
 *          cold answer until some unrelated edit repainted it (the dropdown only
 *          appearing after a Play/Stop round trip).
 *
 *          A `.dbbin` yields nothing, on purpose. It is binary, naming what is
 *          inside it would mean instantiating the runtime, and a free-text field
 *          is a smaller cost than a wasm module loaded to populate a dropdown.
 */
import { parseDragonBonesNames, type DragonBonesArmatureNames } from '../../../sdk/src/dragonbones/skeletonNames';
import { AssetRegistry } from '@/project/AssetRegistry';
import { setEnumSource } from './schema';
import { SceneStore } from './SceneStore';
import type { EnumOption } from '@/types';

/** ref → what that file declares; an empty array is a read that found nothing. */
const cache = new Map<string, DragonBonesArmatureNames[]>();
/** Refs being read, so a repainting inspector cannot start the same read twice. */
const inFlight = new Set<string>();

const SKELETON_FIELD = 'skeletonPath';
const ARMATURE_FIELD = 'armature';

function refOf(data: Readonly<Record<string, unknown>>): string {
    const raw = data[SKELETON_FIELD];
    return typeof raw === 'string' ? raw : '';
}

/**
 * Read the file behind `ref` once. Failure caches an empty list rather than
 * nothing: a path that cannot be read now will not read differently on the next
 * repaint, and retrying per frame would hammer the disk for a broken reference.
 */
function warm(ref: string): void {
    if (!ref || cache.has(ref) || inFlight.has(ref)) return;
    inFlight.add(ref);
    const path = AssetRegistry.refPath(ref);
    if (!path) {
        cache.set(ref, []);
        inFlight.delete(ref);
        return;
    }
    // Optional: a ref can outlive the file it names (deleted, moved outside the
    // editor). Absent is an answer here — an empty list — not a failed IPC call.
    void window.estella.fs.readOptional(path)
        .then((text) => cache.set(ref, text ? parseDragonBonesNames(text) : []))
        .catch(() => cache.set(ref, []))
        .finally(() => {
            inFlight.delete(ref);
            // Repaint whoever is showing this component: the read is the only thing
            // that changed, and an inspector re-renders off the scene revision.
            // Cached now, so the repaint's provider call cannot start another read.
            if (cache.get(ref)?.length) SceneStore.poke();
        });
}

function armaturesFor(data: Readonly<Record<string, unknown>>): DragonBonesArmatureNames[] {
    const ref = refOf(data);
    warm(ref);
    return cache.get(ref) ?? [];
}

const asOptions = (names: readonly string[]): EnumOption[] =>
    names.map((name) => ({ label: name, value: name }));

/** Register both dropdowns. Called once at boot, beside the other enum sources. */
export function installDragonBonesEnumSources(): void {
    // Both exhaustive: the names come out of the referenced file, so one that is
    // not in it names nothing the runtime can play.
    setEnumSource('dragonbonesArmatures', (data) => asOptions(armaturesFor(data).map((a) => a.name)), { exhaustive: true });

    setEnumSource('dragonbonesAnimations', (data) => {
        const armatures = armaturesFor(data);
        if (armatures.length === 0) return [];
        // The animations of THIS entity's armature — a file's armatures do not
        // share an animation list, so offering the union would let a user pick one
        // that its armature cannot play.
        const chosen = data[ARMATURE_FIELD];
        const armature = typeof chosen === 'string' && chosen
            ? armatures.find((a) => a.name === chosen)
            : armatures[0];
        return asOptions(armature?.animations ?? []);
    }, { exhaustive: true });
}

/** Drop the cache — a project close, or an asset edited outside the editor. */
export function clearDragonBonesNameCache(): void {
    cache.clear();
    inFlight.clear();
}
