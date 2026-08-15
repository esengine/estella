// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What a system touches, read off the parameters it already declares.
 *
 *        `Query(Mut(Transform))` says "I write Transform" and `Res(Time)` says
 *        "I read Time" — the schedule has held that information all along and
 *        only ever used it to look up values. Reading it as a set makes two
 *        questions answerable: whether two systems can run at the same time, and
 *        whether the order they DO run in was ever decided by anyone.
 */
import type { SystemDef, SystemParam } from '../ecs/system';
import type { AnyComponentDef } from '../ecs/component';
import type { QueryDescriptor, QueryArg } from '../ecs/query';

/** Everything one system reads and writes, by name. */
export interface SystemAccess {
    readsComponents: ReadonlySet<string>;
    writesComponents: ReadonlySet<string>;
    readsResources: ReadonlySet<string>;
    writesResources: ReadonlySet<string>;
    /**
     * The system asked for the World itself, so nothing about it is declared.
     * Treated as touching everything — the price of the escape hatch.
     */
    opaque: boolean;
}

type MutWrapper = { readonly _type: 'mut'; readonly _component: AnyComponentDef };
type WrappedArg = { readonly _component?: AnyComponentDef };

const componentName = (c: AnyComponentDef): string => c._name;

/** The component a query argument is about, whatever it is wrapped in. Anything
 *  that is not one — a nested array from a mis-spelled `Query([...])` — is not
 *  access, and guessing at it would put `undefined` in the set. */
function argComponent(arg: QueryArg): AnyComponentDef | null {
    const wrapped = (arg as WrappedArg)._component;
    const comp = wrapped ?? (arg as AnyComponentDef | null);
    return typeof (comp as { _name?: unknown } | null)?._name === 'string' ? comp : null;
}

const isMut = (arg: QueryArg): boolean => (arg as MutWrapper)._type === 'mut';

/** A resource's declared name — what `defineResource` stamped on it. */
const resourceName = (r: unknown): string => (r as { _name?: string })?._name ?? String(r);

/** Read a system's declared access. Cheap, and re-read rather than cached: a
 *  system may answer for the data currently loaded (see `touches`). */
export function accessOf(system: SystemDef): SystemAccess {
    const readsComponents = new Set<string>();
    const writesComponents = new Set<string>();
    const readsResources = new Set<string>();
    const writesResources = new Set<string>();
    let opaque = false;

    for (const param of system._params as readonly SystemParam[]) {
        switch (param._type) {
            case 'query': {
                const q = param as QueryDescriptor<readonly QueryArg[]>;
                q._components.forEach((arg) => {
                    const comp = argComponent(arg);
                    if (!comp) return;
                    (isMut(arg) ? writesComponents : readsComponents).add(componentName(comp));
                });
                // A filter decides which entities match, so it is read access:
                // whoever writes that component changes this query's result.
                for (const comp of [...q._with, ...q._without]) readsComponents.add(componentName(comp));
                break;
            }
            case 'removed':
                readsComponents.add(componentName((param as { _component: AnyComponentDef })._component));
                break;
            case 'res':
                readsResources.add(resourceName((param as { _resource: unknown })._resource));
                break;
            case 'res_mut':
                writesResources.add(resourceName((param as { _resource: unknown })._resource));
                break;
            case 'get_world':
                opaque = true;
                break;
            // Commands are applied after the system returns, and an event
            // channel is its own buffered storage — neither races the other
            // systems of the same batch.
            default:
                break;
        }
    }

    // A system that says what it reaches for through the World is no longer
    // opaque: its claim IS the declaration, and it is named by component name
    // because the reason to use the hatch is usually a type registered later.
    // A function is asked now rather than at definition: a system running
    // authored data answers from what is loaded.
    const declared = system._touches;
    const touches = typeof declared === 'function' ? declared() : declared;
    if (touches) {
        for (const name of touches.reads ?? []) readsComponents.add(name);
        for (const name of touches.writes ?? []) writesComponents.add(name);
        opaque = touches.opaque === true;
    }

    return { readsComponents, writesComponents, readsResources, writesResources, opaque };
}

const intersects = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const x of small) if (large.has(x)) return true;
    return false;
};

/**
 * Whether two systems touch the same data in a way that makes their order
 * matter: one writes what the other reads or writes.
 */
export function conflicts(a: SystemAccess, b: SystemAccess): boolean {
    if (a.opaque || b.opaque) return true;
    return intersects(a.writesComponents, b.writesComponents)
        || intersects(a.writesComponents, b.readsComponents)
        || intersects(a.readsComponents, b.writesComponents)
        || intersects(a.writesResources, b.writesResources)
        || intersects(a.writesResources, b.readsResources)
        || intersects(a.readsResources, b.writesResources);
}

/** What two conflicting systems disagree over, for a message that names it. */
export function conflictBetween(a: SystemAccess, b: SystemAccess): string[] {
    if (a.opaque || b.opaque) return ['the World itself'];
    const shared = new Set<string>();
    const add = (x: ReadonlySet<string>, y: ReadonlySet<string>): void => {
        for (const n of x) if (y.has(n)) shared.add(n);
    };
    add(a.writesComponents, b.writesComponents);
    add(a.writesComponents, b.readsComponents);
    add(a.readsComponents, b.writesComponents);
    add(a.writesResources, b.writesResources);
    add(a.writesResources, b.readsResources);
    add(a.readsResources, b.writesResources);
    return [...shared].sort();
}
