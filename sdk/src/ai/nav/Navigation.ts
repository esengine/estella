// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    Navigation.ts
 * @brief   `Nav` resource — holds the active {@link NavSurface} and routes over it.
 *
 * Published by NavPlugin; game code reads it as `Res(Nav)` (or
 * `app.getResource(Nav)`) to swap the surface or query a route directly. It does
 * not say which kind of surface is installed, because nothing above it should
 * have to branch on that.
 */

import { defineResource } from '../../ecs/resource';
import type { Vec3 } from '../../types';
import type { NavPoint, NavQueryOptions, NavSurface } from './NavSurface';

export class Navigation {
    /** Where agents may walk, or null until something builds and installs it. */
    surface: NavSurface | null = null;

    setSurface(surface: NavSurface | null): void {
        this.surface = surface;
    }

    hasSurface(): boolean {
        return this.surface !== null;
    }

    /**
     * Plan a world-space route, or null if there is no surface or no way. See
     * {@link NavSurface.findWorldPath} for what the waypoints carry.
     */
    findWorldPath(from: NavPoint, to: NavPoint, opts?: NavQueryOptions): Vec3[] | null {
        return this.surface ? this.surface.findWorldPath(from, to, opts) : null;
    }
}

export const Nav = defineResource<Navigation>(null!, 'Nav');
