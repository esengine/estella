// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  animator.ts — strings for the `.esanimator` animation-controller editor
 *        (AnimatorEditor.tsx). Shared node-graph chrome uses the `ng.*` keys.
 */
import { defineMessages } from './types';

export const animatorMessages = defineMessages({
    'anim.tabTitle': { en: 'Animator', zh: '动画控制器' },
    'anim.emptyHint': { en: 'Right-click to add a state, drag between states to connect', zh: '右键添加状态,状态间拖拽连线' },
    'anim.stateBtn': { en: 'State', zh: '状态' },
    'anim.addStateTip': { en: 'Add a state', zh: '添加状态' },
    'anim.menuAddState': { en: 'Add state here', zh: '在此添加状态' },
    'anim.menuSetInitial': { en: 'Set as initial', zh: '设为初始态' },
    'anim.menuDeleteState': { en: 'Delete state', zh: '删除状态' },
    'anim.initialState': { en: 'Initial state', zh: '初始状态' },
    'anim.noMotion': { en: 'no motion', zh: '无动作' },
    'anim.always': { en: 'always', zh: '始终' },
    'anim.motionBlend': { en: 'blend', zh: '混合' },
    'anim.motionSpine': { en: 'spine', zh: '骨骼' },
    'anim.motionNested': { en: 'nested', zh: '子状态机' },

    'anim.inspStateTitle': { en: 'State', zh: '状态' },
    'anim.inspTransitionTitle': { en: 'Transition', zh: '转换' },
    'anim.clip': { en: 'Clip', zh: '剪辑' },
    'anim.phClip': { en: 'animation clip ref', zh: '动画剪辑引用' },
    'anim.speed': { en: 'Speed', zh: '速度' },
    'anim.loop': { en: 'Loop', zh: '循环' },
    'anim.target': { en: 'To', zh: '目标' },
    'anim.targetState': { en: 'Target state', zh: '目标状态' },
    'anim.hasExitTime': { en: 'Has exit time', zh: '播完再转' },
    'anim.conditions': { en: 'Conditions', zh: '条件' },
    'anim.addCondition': { en: 'Add condition', zh: '添加条件' },
    'anim.removeCondition': { en: 'Remove condition', zh: '移除条件' },
    'anim.param': { en: 'Parameter', zh: '参数' },
    'anim.op': { en: 'Op', zh: '运算' },

    'anim.params': { en: 'Parameters', zh: '参数' },
    'anim.addParam': { en: 'Add parameter', zh: '添加参数' },
    'anim.removeParam': { en: 'Remove parameter', zh: '移除参数' },
    'anim.noParams': { en: 'No parameters', zh: '暂无参数' },
    'anim.paramType': { en: 'Type', zh: '类型' },
    'anim.type.float': { en: 'Float', zh: '浮点' },
    'anim.type.bool': { en: 'Bool', zh: '布尔' },
    'anim.type.trigger': { en: 'Trigger', zh: '触发器' },

    'anim.toastOpenFailed': { en: 'Failed to open controller: {error}', zh: '打开控制器失败：{error}' },
    'anim.toastCreateFailed': { en: 'Failed to create controller: {error}', zh: '创建控制器失败：{error}' },
    'anim.toastCreated': { en: 'Created {name}', zh: '已创建 {name}' },
});
