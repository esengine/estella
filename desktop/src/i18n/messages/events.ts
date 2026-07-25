// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  events.ts — the Details panel's Events section (authored event → action
 *        wiring). Action/condition names themselves are NOT translated: they are
 *        registry identifiers, like component field keys.
 */
import { defineMessages } from './types';

export const eventMessages = defineMessages({
  'evt.section': { en: 'Events', zh: '事件' },
  'evt.add': { en: 'Add an event wire', zh: '添加事件连线' },
  'evt.empty': {
    en: 'Nothing wired. Add a row to run an action when this entity fires an event — no code.',
    zh: '尚未连线。添加一行，即可在该实体触发事件时执行动作——无需代码。',
  },
  'evt.emptyHint': {
    en: 'Actions come from the same registry the state machines use, so registerAction() shows up here too.',
    zh: '动作来自与状态机相同的注册表，registerAction() 注册的动作也会出现在这里。',
  },
  'evt.event': { en: 'Event', zh: '事件' },
  'evt.target': { en: 'Target', zh: '目标' },
  'evt.targetSelf': { en: 'This entity', zh: '自身' },
  'evt.targetMissing': { en: 'No entity named “{name}”', zh: '找不到名为“{name}”的实体' },
  'evt.targetTip': {
    en: 'Which entity the action runs on — resolved by name, nearest first',
    zh: '动作在哪个实体上执行——按名称就近解析',
  },
  'evt.action': { en: 'Action', zh: '动作' },
  'evt.actionPh': { en: 'action name', zh: '动作名' },
  'evt.argPh': { en: 'argument', zh: '参数' },
  'evt.guard': { en: 'Condition', zh: '条件' },
  'evt.guardPh': { en: 'condition name (optional)', zh: '条件名（可选）' },
  'evt.once': { en: 'Once', zh: '仅一次' },
  'evt.onceTip': { en: 'Run at most once per play session', zh: '每次运行最多执行一次' },
  'evt.remove': { en: 'Remove this wire', zh: '删除该连线' },
  'evt.rowEnabled': { en: 'Enable this wire', zh: '启用该连线' },
  'evt.more': { en: 'Condition and once-only', zh: '条件与仅一次' },
  'evt.unknownAction': { en: 'Unknown action — free text is allowed', zh: '未知动作——允许自由输入' },

  // Descriptions for the engine's own actions, editor-side (same policy as the
  // FSM/BT palette: the sdk registry carries names, the editor carries prose).
  'ai.desc.fsmFire': {
    en: 'Fire a trigger on the target’s state machine',
    zh: '向目标的状态机发送一个触发器',
  },
  'ai.desc.blackboardSet': {
    en: 'Set a blackboard value — key=value',
    zh: '设置黑板变量——key=value',
  },
  'ai.desc.uiSetPage': {
    en: 'Switch a UI controller to a page — controller:page',
    zh: '将 UI 控制器切换到某一页——controller:page',
  },
});
