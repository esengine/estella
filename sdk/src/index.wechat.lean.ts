// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.wechat.lean.ts
 * @brief   ESEngine SDK - WeChat MiniGame entry with no optional subsystems
 *
 * Same engine as index.wechat, minus Spine, DragonBones, physics, 3D physics and
 * video — 259KB of a bundle, measured, in a project using none of them. A
 * package built on this imports the subpaths its own content needs
 * (`esengine/spine`, `esengine/physics`, …), which is what installs them.
 *
 * A scene that needs one nobody imported loads without it and says so, rather
 * than failing: what a lean build IS, is a build that ships less.
 */
export * from './index.wechat.base';
