// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * The REGISTRY_OPS a mock native host leaves to defaults. Every op is required
 * (a real host binds all of them, generated), so a mock that only cares about
 * spawning still answers valid/activity/destruction like a host with nothing
 * disabled and no teardown in flight. Ops the mock already binds are kept.
 */
import { REGISTRY_OPS } from '../../src/ecs/bridge/nativeBindings';

export function installRegistryOpDefaults(scope: Record<string, unknown>, alive?: ReadonlySet<number>): void {
    const pending = new Set<number>();
    const enabled = new Map<number, boolean>();
    let epoch = 0;
    const defaults: Record<keyof typeof REGISTRY_OPS, (...args: never[]) => unknown> = {
        create: () => { throw new Error('mock host: bind es_registry_create'); },
        destroy: () => undefined,
        valid: (e: number) => alive ? alive.has(e) : e > 0,
        entityCount: () => alive?.size ?? 0,
        reserveDestruction: (e: number) => { if (pending.has(e)) return false; pending.add(e); return true; },
        releaseDestruction: (e: number) => { pending.delete(e); },
        destructionPending: (e: number) => pending.has(e),
        setEntityEnabled: (e: number, value: boolean) => { enabled.set(e, value); ++epoch; return true; },
        isEntityActive: (e: number) => enabled.get(e) ?? true,
        isEntityEnabled: (e: number) => enabled.get(e) ?? true,
        hasInactiveEntities: () => [...enabled.values()].some((v) => !v),
        activityEpoch: () => epoch,
        setParent: () => true,
        markComponentChanged: () => undefined,
        componentChangedSince: () => false,
        changeTick: () => 1,
        beginChangeRead: () => 1,
        setChangeAudit: () => undefined,
        auditChanges: () => 0,
        changeAuditTotal: () => 0,
    };
    for (const [op, binding] of Object.entries(REGISTRY_OPS) as [keyof typeof REGISTRY_OPS, string][]) {
        if (typeof scope[binding] !== 'function') scope[binding] = defaults[op];
    }
}

/** `scope` with the op defaults installed, for a call site that builds it inline. */
export function withRegistryOps<T extends Record<string, unknown>>(scope: T): T {
    installRegistryOpDefaults(scope);
    return scope;
}

/** A host scope that binds only the registry ops — for tests of a native app
 *  whose subject (input, say) needs no other host surface. */
export function hostWithRegistryOps(): Record<string, unknown> {
    return withRegistryOps({});
}
