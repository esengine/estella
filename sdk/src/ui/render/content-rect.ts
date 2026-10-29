// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import type { App, Plugin } from '../../app/app';
import { registerComponent } from '../../ecs/component';
import { defineSystem, Schedule } from '../../ecs/system';
import { ContentRect, applyContentRect } from '../core/content-rect';

/**
 * Registers `ContentRect` and keeps the sprites and texts that share an entity with one following it.
 *
 * Only entities whose rect changed since the last run are visited (change tracking), at the end of the update and again at the very
 * end, so a script that resizes something in the frame's last system still draws it at the new size that frame.
 */
export class ContentRectPlugin implements Plugin {
    name = 'contentRect';

    build(app: App): void {
        registerComponent('ContentRect', ContentRect);
        const world = app.world;
        world.enableChangeTracking(ContentRect);
        let seen = -1;
        const sync = (): void => {
            if (!world.anyChangedSince(ContentRect, seen)) return;
            const since = seen;
            // the watermark trails by one tick so a write in this very tick is seen next time too
            seen = world.getWorldTick() - 1;
            for (const entity of world.getEntitiesWithComponents([ContentRect])) {
                if (world.isChangedSince(entity, ContentRect, since)) applyContentRect(world, entity);
            }
        };
        app.addSystemToSchedule(Schedule.PostUpdate, defineSystem([], sync, { name: 'ContentRectSystem' }));
        app.addSystemToSchedule(Schedule.Last, defineSystem([], sync, { name: 'ContentRectLateSystem' }));
    }
}

export const contentRectPlugin = new ContentRectPlugin();
