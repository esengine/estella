import { defineSystem, GetWorld, Text } from 'esengine';
import type { World, TextData } from 'esengine';

import { state } from '../state';

// The proof-of-virtualization readout: mounted entity counts stay flat (~a
// screenful each) no matter how many rows/tiles back the lists.
export const statsSystem = defineSystem(
    [GetWorld()],
    (world: World) => {
        const { list, grid, statsLabel } = state;
        if (!list || !grid || statsLabel === null) return;

        const text =
            `list: ${list.mountedCount()} entities mounted for ${list.data.getCount()} rows · ` +
            `grid: ${grid.mountedCount()} for ${grid.data.getCount()} tiles · wheel-scroll or drag to fling`;
        if (text === state.lastStats) return;
        state.lastStats = text;

        if (!world.valid(statsLabel) || !world.has(statsLabel, Text)) return;
        const t = world.get(statsLabel, Text) as TextData;
        t.content = text;
        world.insert(statsLabel, Text, t);
    },
    { name: 'StatsSystem' },
);
