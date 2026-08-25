// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    esengine.ts
 * @brief   Enough of the SDK for an example system file to be imported and run.
 *
 * @details The differential needs both sides reading one source, so the oracle
 *          has to be the real move.ts rather than a copy living in a test.
 */
export interface StubSystem {
    readonly name: string;
    readonly params: readonly unknown[];
    readonly fn: (...args: any[]) => void;
}

export const Transform = { _name: 'Transform' };
export const Time = { _name: 'Time' };

export function defineComponent(name: string, defaults: Record<string, unknown>): unknown {
    return { _name: name, defaults };
}
export function defineTag(name: string): unknown {
    return { _name: name, defaults: {} };
}
export function Query(...args: unknown[]): unknown {
    return { kind: 'query', args };
}
export function Mut(comp: unknown): unknown {
    return { kind: 'mut', comp };
}
export function Res(resource: unknown): unknown {
    return { kind: 'res', resource };
}
export function Commands(): unknown {
    return { kind: 'commands' };
}
export function ResMut(resource: unknown): unknown {
    return { kind: 'resmut', resource };
}
export const Input = { _name: 'Input' };
export const Sprite = { _name: 'Sprite' };
export const Camera = { _name: 'Camera' };
export function defineSystem(
    params: readonly unknown[],
    fn: (...args: any[]) => void,
    opts?: { name?: string },
): StubSystem {
    return { name: opts?.name ?? '<anonymous>', params, fn };
}
export function addSystemToSchedule(): void { /* the example's main.ts calls this */ }
export function addStartupSystem(): void { /* likewise */ }
export const Schedule = { Update: 'Update' } as const;
