import { defineComponent } from 'esengine';

/**
 * One board tile. `slot` is the fixed board cell this entity sits in (never
 * changes); `tile` is which region of the video it currently SHOWS. Swapping
 * two pieces swaps their `tile`s — the entities and their transforms stay put,
 * only the sampled video region moves. Solved = every piece shows its own slot.
 */
export const PuzzlePiece = defineComponent('PuzzlePiece', {
    slot: 0,
    tile: 0,
});
