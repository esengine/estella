// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    status.ts
 * @brief   Shared AI task status — the return type that unifies FSM actions and
 *          behavior-tree nodes.
 *
 * A registered action may return a Status (a BT leaf that can run across frames)
 * or nothing (a one-shot FSM action). BT treats a `void` return as `Success`;
 * FSM ignores the return entirely. One registry, two consumers.
 */

export enum Status {
    Success = 'success',
    Failure = 'failure',
    Running = 'running',
}
