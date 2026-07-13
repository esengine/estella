// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  nodegraph.ts — State Machine + Behavior Tree editors and the shared graph canvas.
 */
import { defineMessages } from './types';

export const nodegraphMessages = defineMessages({
    // — Shared graph-editor chrome (ng.*) —
    // The "open a file" placeholder is split around the <code> extension so the
    // markup survives translation (pre + <code>.ext</code> + post).
    'ng.openHintPre': { en: 'Open a ', zh: '从内容浏览器打开 ' },
    'ng.openHintPost': { en: ' from the Content Browser to edit it.', zh: ' 文件进行编辑。' },
    'ng.save': { en: 'Save', zh: '保存' },
    'ng.deleteSelected': { en: 'Delete selected', zh: '删除所选' },
    'ng.name': { en: 'Name', zh: '名称' },
    'ng.phActionName': { en: 'action name', zh: '动作名称' },
    'ng.actionArg': { en: 'Argument', zh: '参数' },
    'ng.phActionArg': { en: 'optional argument (e.g. a clip path)', zh: '可选参数（如剪辑路径）' },
    'ng.phConditionName': { en: 'condition name', zh: '条件名称' },
    'ng.inPortTip': { en: 'Edges land here', zh: '连线在此接入' },
    'ng.outPortTip': { en: 'Drag to another node to connect', zh: '拖到另一个节点以连接' },

    // — State Machine editor (fsm.*) —
    'fsm.tabTitle': { en: 'State Machine', zh: '状态机' },
    'fsm.addStateTip': { en: 'Add state', zh: '添加状态' },
    'fsm.stateBtn': { en: 'State', zh: '状态' },
    'fsm.menuAddState': { en: 'Add State', zh: '添加状态' },
    'fsm.menuSetInitial': { en: 'Set as initial', zh: '设为初始状态' },
    'fsm.menuDeleteState': { en: 'Delete state', zh: '删除状态' },
    'fsm.emptyHint': {
        en: 'Add a state, then drag from its handle to another to add a transition.',
        zh: '先添加一个状态，再从它的手柄拖到另一个状态以添加转移。',
    },
    'fsm.initialState': { en: 'Initial state', zh: '初始状态' },
    'fsm.noActions': { en: 'no actions', zh: '无动作' },
    'fsm.always': { en: '(always)', zh: '（总是）' },
    'fsm.guardCount': { en: '{count} guards', zh: '{count} 个守卫' },
    // — Builtin action/condition descriptions (suggest dropdowns) —
    'ai.desc.timelinePlay': { en: "Play the agent entity's TimelinePlayer", zh: '播放代理实体的 TimelinePlayer' },
    'ai.desc.timelinePause': { en: "Pause the agent entity's TimelinePlayer", zh: '暂停代理实体的 TimelinePlayer' },
    'ai.desc.timelineFinished': { en: 'True once the timeline has finished', zh: 'Timeline 播完后为真' },
    'ai.desc.spriteAnimPlay': {
        en: "Play the agent's sprite flipbook; the argument switches to that clip",
        zh: '播放代理实体的精灵翻页动画；参数可切换到指定剪辑',
    },
    'ai.desc.spriteAnimRestart': {
        en: 'Rewind the sprite flipbook to frame 0 and play (argument switches clip)',
        zh: '将精灵翻页动画回卷到第 0 帧并播放（参数可切换剪辑）',
    },
    'ai.desc.spriteAnimStop': { en: 'Pause the sprite flipbook', zh: '暂停精灵翻页动画' },
    'ai.desc.spriteAnimFinished': {
        en: 'True once a one-shot sprite clip has finished',
        zh: '一次性精灵剪辑播完后为真',
    },
    'fsm.inspStateTitle': { en: 'State', zh: '状态' },
    'fsm.inspTransitionTitle': { en: 'Transition', zh: '转移' },
    'fsm.target': { en: 'Target', zh: '目标' },
    'fsm.targetState': { en: 'Target state', zh: '目标状态' },
    'fsm.trigger': { en: 'Trigger (event)', zh: '触发器（事件）' },
    'fsm.phEventName': { en: 'event name', zh: '事件名称' },
    'fsm.condition': { en: 'Condition', zh: '条件' },
    'fsm.guardSub': { en: 'Guard (blackboard)', zh: '守卫（黑板）' },
    'fsm.phKey': { en: 'key', zh: '键名' },
    'fsm.guardOp': { en: 'Guard operator', zh: '守卫运算符' },
    'fsm.value': { en: 'Value', zh: '值' },
    'fsm.phValue': { en: 'value', zh: '值' },
    'fsm.toastOpenFailed': { en: 'Failed to open state machine: {error}', zh: '打开状态机失败：{error}' },
    'fsm.toastCreateFailed': { en: 'Failed to create state machine: {error}', zh: '创建状态机失败：{error}' },
    'fsm.toastCreated': { en: 'Created state machine: {name}', zh: '已创建状态机：{name}' },

    // — Behavior Tree editor (bt.*) —
    // Type labels are display names only; the persisted node type ids stay English.
    'bt.tabTitle': { en: 'Behavior Tree', zh: '行为树' },
    'bt.typeSequence': { en: 'Sequence', zh: '序列' },
    'bt.typeSelector': { en: 'Selector', zh: '选择器' },
    'bt.typeParallel': { en: 'Parallel', zh: '并行' },
    'bt.typeInverter': { en: 'Inverter', zh: '反转器' },
    'bt.typeSucceeder': { en: 'Succeeder', zh: '成功器' },
    'bt.typeRepeater': { en: 'Repeater', zh: '重复器' },
    'bt.typeWait': { en: 'Wait', zh: '等待' },
    'bt.typeAction': { en: 'Action', zh: '动作' },
    'bt.typeCondition': { en: 'Condition', zh: '条件' },
    'bt.unnamed': { en: '(unnamed)', zh: '（未命名）' },
    'bt.deleteNode': { en: 'Delete node', zh: '删除节点' },
    'bt.menuAdd': { en: 'Add {type}', zh: '添加{type}' },
    'bt.menuAddChild': { en: 'Add child: {type}', zh: '添加子节点：{type}' },
    'bt.emptyHint': {
        en: 'Drag from a node\'s handle to another to set parent → child.',
        zh: '从一个节点的手柄拖到另一个节点，以建立父 → 子关系。',
    },
    'bt.inspNodeTitle': { en: 'Node', zh: '节点' },
    'bt.type': { en: 'Type', zh: '类型' },
    'bt.nodeType': { en: 'Node type', zh: '节点类型' },
    'bt.count': { en: 'Count (0 = forever)', zh: '次数（0 = 无限）' },
    'bt.seconds': { en: 'Seconds', zh: '秒数' },
    'bt.successPolicy': { en: 'Success policy', zh: '成功策略' },
    'bt.policyAll': { en: 'all children', zh: '所有子节点' },
    'bt.policyOne': { en: 'any child', zh: '任一子节点' },
    'bt.addChildSub': { en: 'Add child', zh: '添加子节点' },
    'bt.childNodeType': { en: 'Child node type', zh: '子节点类型' },
    'bt.addBtn': { en: '+ Add', zh: '+ 添加' },
    'bt.toastOpenFailed': { en: 'Failed to open behavior tree: {error}', zh: '打开行为树失败：{error}' },
    'bt.toastCreateFailed': { en: 'Failed to create behavior tree: {error}', zh: '创建行为树失败：{error}' },
    'bt.toastCreated': { en: 'Created behavior tree: {name}', zh: '已创建行为树：{name}' },
});
