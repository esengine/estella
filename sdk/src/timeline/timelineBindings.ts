// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineBindings.ts
 * @brief   A track's target, by path below the timeline's root or through one of the player's bindings.
 *
 * @details A track names what it animates by a name path below the entity playing the timeline. A path that starts
 *          `@Name` names a BINDING instead: the entity the playing `TimelinePlayer` binds `Name` to, anywhere in the
 *          scene, with the rest of the path (`@Hero/Arm`) below it. That is Unity's PlayableDirector binding and UE's
 *          possessable: one timeline, played by two players, drives two different characters, and a cutscene can move
 *          things that are not its children. Every track resolves its target through here, so every kind of track
 *          can be bound.
 */
import { resolveChildEntity } from '../ecs/childPath';
import type { World } from '../ecs/world';
import type { Entity } from '../types';
import { TimelinePlayer, type TimelinePlayerData } from './TimelinePlayerComponent';

/** Whether a track path goes through a binding. */
export const isBoundPath = (path: string): boolean => path.startsWith('@');

/** A bound path's binding name and the path below the bound entity: `@Hero/Arm` → `Hero`, `Arm`. */
export function splitBoundPath(path: string): { name: string; rest: string } {
    const slash = path.indexOf('/');
    return slash < 0 ? { name: path.slice(1), rest: '' } : { name: path.slice(1, slash), rest: path.slice(slash + 1) };
}

/** The entity `player` binds `name` to, or null when it binds nothing by that name or the entity is gone. */
export function boundEntity(world: Pick<World, 'tryGet' | 'valid'>, player: Entity, name: string): Entity | null {
    const data = world.tryGet(player, TimelinePlayer) as TimelinePlayerData | null;
    const i = data?.bindingNames?.indexOf(name) ?? -1;
    const e = i >= 0 ? data!.bindings?.[i] : undefined;
    return e && e > 0 && world.valid(e as Entity) ? (e as Entity) : null;
}

/**
 * The entity a track path names for a timeline played by `player` with its paths below `root` (the player itself, or
 * a nested sequence's root): a binding of the player's when the path starts `@`, else a name path below `root`.
 */
export function resolveTimelinePath(
    world: Pick<World, 'tryGet' | 'valid'>, player: Entity, root: Entity, path: string,
): Entity | null {
    if (!isBoundPath(path)) return resolveChildEntity(world, root, path);
    const { name, rest } = splitBoundPath(path);
    const bound = boundEntity(world, player, name);
    if (bound == null) return null;
    return rest ? resolveChildEntity(world, bound, rest) : bound;
}
