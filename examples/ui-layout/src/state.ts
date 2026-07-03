import type { Entity } from 'esengine';

// The live playground state: the demo FlexContainer, its item boxes, the
// readout label, and the current option index for each control. The control
// buttons advance an index and re-apply; the Yoga layout pass re-flows the
// items next frame.
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
