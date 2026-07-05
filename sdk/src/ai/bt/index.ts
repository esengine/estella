// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    index.ts
 * @brief   Behavior-tree core barrel (pure runtime; engine binding is separate).
 */

export type { BtNodeType, BtNode, BtDefinition } from './types';
export { tickBt, createBtRunState, type BtRunState } from './BtRunner';
