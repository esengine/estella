// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    animatorMigrate.ts
 * @brief   Bringing a parsed `.esanimator` to the version this build writes.
 *
 * @details A version is a property of the FILE, not of a controller: one built in
 *          code never passes through here, having no older spelling to be read
 *          from. What the guard buys is the other direction — a file from a later
 *          build is refused rather than read for the parts this one recognises,
 *          because layers it cannot see would animate a visibly wrong character
 *          and nothing would say so.
 */

import {
    ANIMATOR_FORMAT_VERSION,
    type AnimatorControllerDef, type AnimatorLayer,
} from './Animator';

/** What a pass over a controller blob came to. */
export interface AnimatorMigration {
    def: AnimatorControllerDef;
    /** Whether anything was upgraded; a caller may ask the author to re-save. */
    migrated: boolean;
    /** The version the file claimed — 1 for one written before layers existed. */
    fromVersion: number;
}

/** The version a file with no `version` field was written at. */
const UNVERSIONED = 1;

function isScope(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const o = value as Record<string, unknown>;
    return Array.isArray(o['states']) && typeof o['initialState'] === 'string';
}

/**
 * Total and idempotent: already-current data comes back with `migrated: false`.
 * Throws for a shape that cannot be reconciled, and for a version this build does
 * not know.
 */
export function migrateAnimatorController(raw: unknown): AnimatorMigration {
    if (typeof raw !== 'object' || raw === null) {
        throw new Error('Animator controller data must be an object');
    }
    const obj = raw as Record<string, unknown>;
    if (!isScope(obj)) {
        throw new Error('Animator controller must have a "states" array and an "initialState"');
    }

    const claimed = obj['version'];
    if (claimed !== undefined && (typeof claimed !== 'number' || !Number.isInteger(claimed))) {
        throw new Error('Animator controller "version" must be an integer');
    }
    const fromVersion = (claimed as number | undefined) ?? UNVERSIONED;
    if (fromVersion > ANIMATOR_FORMAT_VERSION) {
        throw new Error(
            `Animator controller is version ${fromVersion}; this build reads up to `
            + `${ANIMATOR_FORMAT_VERSION}. Update the engine rather than opening it here.`,
        );
    }
    if (obj['layers'] !== undefined) {
        if (!Array.isArray(obj['layers'])) {
            throw new Error('Animator controller "layers" must be an array');
        }
        for (const layer of obj['layers'] as AnimatorLayer[]) {
            if (!isScope(layer) || typeof layer.name !== 'string') {
                throw new Error('Every animator layer needs a name, states and an initialState');
            }
        }
    }

    const def = obj as unknown as AnimatorControllerDef;
    if (fromVersion === ANIMATOR_FORMAT_VERSION) {
        return { def, migrated: false, fromVersion };
    }
    // Version 1 is version 2 without layers, which reads correctly as a stack of
    // one. Stamping it is the whole upgrade, and it is what makes a re-save land
    // on a file the guard above will recognise.
    return {
        def: { ...def, version: ANIMATOR_FORMAT_VERSION },
        migrated: true,
        fromVersion,
    };
}
