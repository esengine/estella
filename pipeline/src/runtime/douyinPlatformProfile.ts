// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  douyinPlatformProfile.ts — the module a Douyin package installs its
 *        platform from, as the export profile's `runtimeProfileModule`.
 *
 * A built-in vendor goes through the same door a project-authored one does:
 * `esengine/minigame` installs nothing until a host is named, and the generated
 * entry names this. That is why Douyin needs no SDK entry of its own — one per
 * vendor is the shape this family exists to avoid.
 */
import { douyinProfile } from 'esengine/douyin';

export default douyinProfile;
