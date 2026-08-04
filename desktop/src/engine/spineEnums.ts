// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  spineEnums.ts
 * @brief Fills the spine animation/skin dropdowns from the skeleton LOADED on that
 *        entity, so the inspector offers the names it can actually play instead of a
 *        raw text field. Importing this performs the registration (side effect).
 *
 * @details Unlike DragonBones (which reads the file, see dragonBonesNames.ts), the
 *          names here come from the live instance: a spine skeleton can be binary
 *          (`.skel`) across four runtime versions, so the runtime that parsed it is
 *          the only thing that can name what is inside. That is what the source's
 *          `entity` argument is for. Nothing loaded yet ⇒ no options ⇒ the field
 *          stays plainly editable, and the binding load pokes a repaint when it lands.
 */
import { setEnumSource } from './schema';
import { SceneModel } from './SceneModel';
import { EngineHost } from './EngineHost';
import type { EnumOption } from '@/types';

const options = (entity: number | undefined, pick: (rt: number) => string[]): EnumOption[] => {
  const rt = entity != null ? SceneModel.runtimeFor(entity) : undefined;
  return rt != null ? pick(rt).map((name) => ({ label: name, value: name })) : [];
};

export function installSpineEnumSources(): void {
  // Exhaustive: the names come out of the loaded skeleton, so one that isn't in it
  // names nothing.
  setEnumSource('spineAnimations', (_data, entity) => options(entity, (rt) => EngineHost.spineAnimations(rt)), { exhaustive: true });
  setEnumSource('spineSkins', (_data, entity) => options(entity, (rt) => EngineHost.spineSkins(rt)), { exhaustive: true });
}
