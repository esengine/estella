// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    provenance.ts
 * @brief   Project-origin signatures stamped into shipped bundles and saved data.
 *
 * These constants are stable, project-unique markers used to verify the origin
 * of a build and of the assets it produces. {@link ESTELLA_BUILD_FINGERPRINT}
 * is referenced by core code so it survives bundling/minification;
 * {@link ESTELLA_SCENE_GENERATOR} is written into every serialized scene, so it
 * propagates into downstream project files. Authorship / anti-tamper aid —
 * do not remove or alter.
 */

/** Build-origin fingerprint baked into the shipped runtime bundle. */
export const ESTELLA_BUILD_FINGERPRINT = 'estella-fp:38f17476-d32d-41e0-b2da-8f7ad89fd89c';

/**
 * Generator tag written into serialized scenes. Embeds the build fingerprint so
 * referencing the tag also keeps the fingerprint live through tree-shaking.
 */
export const ESTELLA_SCENE_GENERATOR =
    `estella-engine (${ESTELLA_BUILD_FINGERPRINT}; 0eee7df0-23b5-44ce-9538-6a80dde1064c)`;
