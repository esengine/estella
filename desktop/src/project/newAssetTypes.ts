// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  newAssetTypes.ts
 * @brief The single list of "New …" asset creators behind the Content Browser's
 *        create menu. One entry per creatable type carries its menu label and its
 *        `create(dir)` — so adding a type is one entry here, not a menu row + an
 *        import + a bespoke wrapper scattered across ContentBrowser.
 *
 * Two creator shapes, distinguished by return value:
 *  - blank-file assets (scene / input map / locale table) return the new path so
 *    the Content Browser reveals + drops it into rename; they have no editor of
 *    their own, so a failure toast key is supplied here.
 *  - editor-backed assets (graphs / material / animation) open their own editor
 *    and refresh + toast themselves, so they return void and carry no error key.
 */
import type { MsgKey } from '@/i18n';
import { BUILTIN_SHADER_TEMPLATES } from 'esengine';
import { ProjectStore } from './ProjectStore';
import { createAnimationClip } from '@/timeline/openClip';
import { createMaterial, createShaderAsset } from '@/material/openMaterial';
import { createMaterialGraph } from '@/material/openMaterialGraph';
import { createStateMachine } from '@/fsm/openStateMachine';
import { createAnimatorController } from '@/animator/openAnimatorController';
import { createBehaviorTree } from '@/bt/openBehaviorTree';

/** Create an asset in `dir`; a returned path means "reveal + rename me" (see file). */
export type CreateAsset = (dir: string) => Promise<string | void> | string | void;

export interface NewAssetEntry {
  labelKey: MsgKey;
  /** Direct creator (mutually exclusive with `templates`). */
  create?: CreateAsset;
  /** A submenu — one creator per built-in template (the shader/material picker). */
  templates?: () => { label: string; create: CreateAsset }[];
  /** Failure toast key; only blank-file creators need it (editors toast themselves). */
  errorKey?: MsgKey;
}

const shaderTemplateMenu = (make: (dir: string, templateId: string) => Promise<void>) => () =>
  BUILTIN_SHADER_TEMPLATES.map((tpl) => ({ label: tpl.label, create: (dir: string) => make(dir, tpl.id) }));

export const NEW_ASSET_TYPES: NewAssetEntry[] = [
  { labelKey: 'cb.menuNewScene', create: (dir) => ProjectStore.createSceneFile(dir), errorKey: 'cb.newSceneFailed' },
  { labelKey: 'cb.menuNewAnimation', create: createAnimationClip },
  { labelKey: 'cb.menuNewInputMap', create: (dir) => ProjectStore.createInputMapFile(dir), errorKey: 'cb.newInputMapFailed' },
  { labelKey: 'cb.menuNewLocaleTable', create: (dir) => ProjectStore.createLocaleTableFile(dir), errorKey: 'cb.newLocaleTableFailed' },
  { labelKey: 'cb.menuNewMaterial', templates: shaderTemplateMenu(createMaterial) },
  { labelKey: 'cb.menuNewMaterialGraph', create: createMaterialGraph },
  { labelKey: 'cb.menuNewShader', templates: shaderTemplateMenu(createShaderAsset) },
  { labelKey: 'cb.menuNewStateMachine', create: createStateMachine },
  { labelKey: 'cb.menuNewAnimatorController', create: createAnimatorController },
  { labelKey: 'cb.menuNewBehaviorTree', create: createBehaviorTree },
];
