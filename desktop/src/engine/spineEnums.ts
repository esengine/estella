// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  spineEnums.ts
 * @brief Registers the spine animation/skin fields as per-entity dynamic enums, so
 *        the inspector offers the loaded skeleton's actual animation/skin names as a
 *        dropdown instead of a raw text field. Importing this performs the
 *        registration (side effect).
 */
import { registerDynamicEnum } from './schema';
import { SceneModel } from './SceneModel';
import { EngineHost } from './EngineHost';

const names = (sourceId: number, pick: (rt: number) => string[]): string[] => {
  const rt = SceneModel.runtimeFor(sourceId);
  return rt != null ? pick(rt) : [];
};

registerDynamicEnum('SpineAnimation', 'animation', (id) => names(id, (rt) => EngineHost.spineAnimations(rt)));
registerDynamicEnum('SpineAnimation', 'skin', (id) => names(id, (rt) => EngineHost.spineSkins(rt)));
