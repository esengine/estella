// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  controllers.ts — the Controllers panel + the Details gear-dot affordance.
 */
import { defineMessages } from './types';

export const controllerMessages = defineMessages({
  'panel.controllers': { en: 'Controllers', zh: '控制器' },

  'ctrl.title': { en: 'Controllers', zh: '控制器' },
  'ctrl.record': { en: 'Record', zh: '录制' },
  'ctrl.recordTitle': {
    en: 'Record: editing a geared field writes the active controller page',
    zh: '录制：编辑受控字段时写入当前控制器页',
  },
  'ctrl.emptyNoSelection': {
    en: 'Select a UI entity to author its controllers.',
    zh: '选择一个 UI 实体来编辑它的控制器。',
  },
  'ctrl.emptyNotUi': {
    en: 'The selected entity is not a UI element (no Canvas / UINode).',
    zh: '所选实体不是 UI 元素（没有 Canvas / UINode）。',
  },
  'ctrl.hintAdd': {
    en: 'No controllers yet. Add one below, then gear fields to it in the Details panel.',
    zh: '还没有控制器。在下方添加一个，然后在细节面板中把字段绑定到它。',
  },
  'ctrl.newController': { en: 'New controller name', zh: '新控制器名称' },
  'ctrl.addController': { en: 'Add controller', zh: '添加控制器' },
  'ctrl.active': { en: 'Active', zh: '活动' },
  'ctrl.deleteController': { en: 'Delete controller', zh: '删除控制器' },
  'ctrl.newPage': { en: 'New page', zh: '新建页' },
  'ctrl.addPage': { en: 'Add page', zh: '添加页' },
  'ctrl.removeCurrentPage': { en: 'Remove the current page', zh: '删除当前页' },

  'ctrl.gearBind': { en: 'Gear this field to the active controller', zh: '将该字段绑定到活动控制器' },
  'ctrl.gearUnbind': { en: 'Remove gear (unbind from controller)', zh: '移除绑定（从控制器解绑）' },
});
