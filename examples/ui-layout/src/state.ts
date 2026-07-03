import type { Entity } from 'esengine';

// Live playground state: the demo FlexContainer, its item boxes, the readout, and
// the current option index per control (a button click advances its index + re-applies).
export const state = {
    container: 0 as Entity,
    readout: 0 as Entity,
    items: [] as Entity[],

    dir: 0,     // DIRECTIONS index — Row
    just: 0,    // JUSTIFY index — flex-start
    align: 0,   // ALIGN index — flex-start
    wrap: 0,    // WRAP index — nowrap
    count: 1,   // COUNTS index — 5 items
};
