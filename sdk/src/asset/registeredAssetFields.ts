// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { AssetFieldMeta } from '../ecs/component.generated';

/** Scene slots whose file loader shares a playback or graph registry with game code. */
export const registeredAssetFields = {
    SpriteAnimator: { field: 'clip', type: 'anim-clip', fileExtension: '.esanim' },
    TimelinePlayer: { field: 'timeline', type: 'timeline', fileExtension: '.estimeline' },
    Animator: { field: 'controller', type: 'animatorcontroller', fileExtension: '.esanimator' },
    StateMachineAgent: { field: 'fsm', type: 'statemachine', fileExtension: '.esfsm' },
    BehaviorTreeAgent: { field: 'bt', type: 'behaviortree', fileExtension: '.esbt' },
    ScriptGraphAgent: { field: 'graph', type: 'scriptgraph', fileExtension: '.esgraph' },
} as const satisfies Record<string, AssetFieldMeta>;
