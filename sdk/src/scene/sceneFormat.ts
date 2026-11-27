// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

/**
 * Current scene format version, incremented for incompatible migrations.
 * 2 renamed Light2D and Mesh2D, 3 added the 2D suffix to flat physics
 * components, and 4 aligned 2D joint names with their 3D counterparts.
 */
export const SCENE_FORMAT_VERSION = 4;

/** Older dotted strings use their leading integer. Missing or invalid versions are format 1. */
export function parseSceneFormatVersion(version: unknown): number {
    if (typeof version === 'number') return Number.isInteger(version) && version > 0 ? version : 1;
    if (typeof version === 'string') {
        const leading = /^\s*(\d+)/.exec(version);
        if (leading) return Math.max(1, Number(leading[1]));
    }
    return 1;
}

/** Check the version before consuming or replacing the document. */
export function requireSupportedSceneVersion(version: unknown): number {
    const fromVersion = parseSceneFormatVersion(version);
    if (fromVersion > SCENE_FORMAT_VERSION) {
        throw new Error(
            `Scene format version ${fromVersion} is newer than this engine supports ` +
            `(${SCENE_FORMAT_VERSION}); upgrade the engine to load it.`,
        );
    }
    return fromVersion;
}
