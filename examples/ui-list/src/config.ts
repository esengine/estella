import type { Color } from 'esengine';

// Viewport sizes must be known up front (createListView needs them for the
// scroll math); the slot boxes in the scene use the same numbers.
export const LIST_W = 340;
export const LIST_H = 378;
export const GRID_W = 336;
export const GRID_H = 378;

// List rows: 44px rows with a 6px gap → ~7.5 visible of the 500 backing rows.
export const ROW_H = 44;
export const ROW_SPACING = 6;
export const CONTACTS = 500;

// Grid tiles: 4 columns of 78px tiles + 8px spacing = 336px = GRID_W exactly.
export const GRID_COLUMNS = 4;
export const TILE = 78;
export const TILE_SPACING = 8;
export const TILES = 120;

export const CONTROL_H = 32;

// Deterministic "contact" names — no randomness, so reloads look identical.
const FIRST = ['Ada', 'Grace', 'Alan', 'Edsger', 'Barbara', 'Donald', 'Margaret', 'Dennis', 'Radia', 'Ken'];
const LAST = ['Lovelace', 'Hopper', 'Turing', 'Dijkstra', 'Liskov', 'Knuth', 'Hamilton', 'Ritchie', 'Perlman', 'Thompson'];

export interface Contact {
    id: number;
    name: string;
}

export function makeContact(id: number): Contact {
    // 7 is coprime with the table size and the decade shift breaks the fixed
    // first↔last pairing, so neighbours differ in both names.
    return { id, name: `${FIRST[id % FIRST.length]} ${LAST[(id * 7 + Math.floor(id / LAST.length)) % LAST.length]}` };
}

// Hue wheel for row stripes and grid tiles (s/l fixed, dark-theme friendly).
export function hueColor(i: number, lightness = 0.55): Color {
    const h = ((i * 47) % 360) / 60;
    const c = (1 - Math.abs(2 * lightness - 1)) * 0.62;
    const x = c * (1 - Math.abs((h % 2) - 1));
    const m = lightness - c / 2;
    const [r, g, b] =
        h < 1 ? [c, x, 0] :
        h < 2 ? [x, c, 0] :
        h < 3 ? [0, c, x] :
        h < 4 ? [0, x, c] :
        h < 5 ? [x, 0, c] : [c, 0, x];
    return { r: r + m, g: g + m, b: b + m, a: 1 };
}
