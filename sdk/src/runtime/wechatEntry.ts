// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  wechatEntry.ts — what every WeChat entry does before it hands the SDK over.
 *
 * A CALL, for the reason webEntry is one: as module side effects in the shared
 * base these were dropped from both WeChat entries, so a WeChat package never
 * registered the engine components that have no typed const (MeshSkin among
 * them) or the built-in AI names.
 */
import { setPlatform } from '../platform';
import { wechatAdapter, initWeChatPlatform } from '../platform/wechat';
import { ensureBuiltinComponentsRegistered, markEngineComponentBaseline } from '../ecs/component';
import { ensureBuiltinAiRegistrations } from '../ai/builtins';

export function installWeChatEntry(): void {
    initWeChatPlatform();
    setPlatform(wechatAdapter);
    ensureBuiltinComponentsRegistered();
    ensureBuiltinAiRegistrations();
    markEngineComponentBaseline();
}
