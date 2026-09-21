// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.lean.ts
 * @brief   ESEngine SDK - Web entry with no optional subsystems
 *
 * Same engine as `index`, minus Spine, DragonBones, physics, 3D physics,
 * tilemaps, script graphs, gameplay AI, replication and video. A package built
 * on this imports the subpaths its own content needs (`esengine/tilemap`,
 * `esengine/physics`, …), which is what installs them.
 *
 * A scene that needs one nobody imported loads without it and says so: what a
 * lean build IS, is a build that ships less.
 */
import { installWebEntry } from './runtime/webEntry';

installWebEntry();

export * from './index.base';
