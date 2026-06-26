// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Public entry for the editor command system. Importing it registers
 *          every command (via ./editorCommands side effect) and re-exports the
 *          registry + helpers consumers need.
 */
import './editorCommands';

export { commands } from './registry';
export { formatKeybinding } from './keybinding';
export type { Command, Keybinding } from './types';
