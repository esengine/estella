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
    en: 'Record: edits write into the active controller’s current page (un-geared fields gear themselves)',
    zh: '录制：编辑写入活动控制器的当前页（未绑定的字段会自动绑定）',
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
  'ctrl.removePage': { en: 'Remove this page (clears its gear values)', zh: '删除此页（清除其绑定值）' },
  'ctrl.addInteraction': {
    en: 'Add a $interaction controller (pointer-driven button states)',
    zh: '添加 $interaction 控制器（指针驱动的按钮状态）',
  },
  'ctrl.interactionTitle': {
    en: 'Built-in pointer controller — the name is fixed',
    zh: '内置指针控制器——名称固定',
  },
  'ctrl.renameHint': { en: 'Double-click to rename (gears follow)', zh: '双击重命名（绑定会跟随更新）' },
  'ctrl.inheritedFrom': { en: 'Inherited from an ancestor', zh: '继承自祖先实体' },
  'ctrl.chipHint': {
    en: 'Click to preview · double-click to rename · drag to reorder',
    zh: '单击预览 · 双击重命名 · 拖拽排序',
  },
  'ctrl.gearsTitle': { en: 'Gears on this entity', zh: '此实体的绑定' },
  'ctrl.gearPagesSuffix': { en: ' pages', zh: ' 页' },

  'ctrl.gearBind': { en: 'Gear this field to the active controller', zh: '将该字段绑定到活动控制器' },
  'ctrl.gearSettings': { en: 'Gear settings (transition / unbind)', zh: '绑定设置（过渡 / 解绑）' },
  'ctrl.gearUnbind': { en: 'Remove gear (unbind from controller)', zh: '移除绑定（从控制器解绑）' },
  'ctrl.gearDuration': { en: 'Duration (s)', zh: '时长（秒）' },
  'ctrl.gearEasing': { en: 'Easing', zh: '缓动' },
});
