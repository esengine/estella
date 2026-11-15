// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { ChildProcess, SpawnOptions, SpawnSyncOptions, SpawnSyncReturns } from 'node:child_process';

export interface ToolLaunch {
    shellPrefix?: string;
}

export const TIMED_OUT: number;
export function shellLine(cmd: string, args: readonly string[], prefix?: string): string;
export function runTool(
    cmd: string, args: readonly string[], options?: SpawnSyncOptions & ToolLaunch,
): SpawnSyncReturns<string | Buffer> & { timedOut?: boolean };
export function mustRunTool(
    cmd: string, args: readonly string[], options?: SpawnSyncOptions & ToolLaunch,
): SpawnSyncReturns<string | Buffer>;
export function spawnTool(
    cmd: string, args: readonly string[], options?: SpawnOptions & ToolLaunch,
): ChildProcess;
