// SPDX-License-Identifier: Apache-2.0
// Video Puzzle — N×N tiles, each a live REGION of one playing video.
//
// The mechanism is the point of this example: there is exactly ONE decoded
// video stream. The scene's "Preview" entity carries Sprite + Video, so the
// engine's video system decodes the clip and keeps that sprite's `texture`
// handle alive. Every puzzle piece simply SHARES that texture handle and picks
// its region with the Sprite's `uvOffset`/`uvScale` — no per-piece decoding,
// no extra API. Click two tiles to swap which region each one shows.
import {
    addSystemToSchedule, defineSystem, Schedule,
    Query, Mut, Res, Commands, Input, UICameraInfo,
    Transform, Sprite, Video,
} from 'esengine';
import type { UICameraData } from 'esengine';
import { PuzzlePiece } from './components';

const GRID = 3;              // GRID × GRID tiles
const TILE = 96;             // world size of one tile
const GAP = 4;               // spacing so the seams read as pieces
const BOARD_X = -96;         // board center (preview sits to the right)
const BOARD_Y = 0;

const SELECTED_TINT = { r: 1, g: 0.85, b: 0.4, a: 1 };
const NORMAL_TINT = { r: 1, g: 1, b: 1, a: 1 };
const SOLVED_TINT = { r: 0.65, g: 1, b: 0.7, a: 1 };

const slotX = (slot: number) => BOARD_X + ((slot % GRID) - (GRID - 1) / 2) * (TILE + GAP);
const slotY = (slot: number) => BOARD_Y - (Math.floor(slot / GRID) - (GRID - 1) / 2) * (TILE + GAP);

/**
 * The video texture samples like any flipY-uploaded image: v = 0 is the
 * image's BOTTOM row (the same convention atlas frames use). Tile 0 is the
 * top-left region, so its v-offset is the top band: 1 - 1/GRID.
 */
function tileUv(tile: number): { offset: { x: number; y: number }; scale: { x: number; y: number } } {
    const col = tile % GRID;
    const row = Math.floor(tile / GRID);
    return {
        offset: { x: col / GRID, y: 1 - (row + 1) / GRID },
        scale: { x: 1 / GRID, y: 1 / GRID },
    };
}

/** Fisher–Yates over an even number of transpositions keeps a swap puzzle
 *  solvable by construction; reshuffle away the already-solved deal. */
function shuffledTiles(): number[] {
    const tiles = Array.from({ length: GRID * GRID }, (_, i) => i);
    do {
        for (let i = tiles.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
        }
    } while (tiles.every((t, i) => t === i));
    return tiles;
}

let selectedSlot = -1;
let solved = false;

const spawnBoardSystem = defineSystem(
    [Query(PuzzlePiece), Commands()],
    (pieces, cmds) => {
        if (!pieces.isEmpty()) return;
        selectedSlot = -1;
        solved = false;
        const tiles = shuffledTiles();
        for (let slot = 0; slot < GRID * GRID; slot++) {
            const uv = tileUv(tiles[slot]);
            cmds.spawn()
                .insert(Transform, { position: { x: slotX(slot), y: slotY(slot), z: 0 } })
                .insert(Sprite, {
                    size: { x: TILE, y: TILE },
                    color: NORMAL_TINT,
                    uvOffset: uv.offset,
                    uvScale: uv.scale,
                })
                .insert(PuzzlePiece, { slot, tile: tiles[slot] });
        }
    },
    { name: 'SpawnBoardSystem' },
);

/**
 * Mirror the live video texture onto every piece. The Video component keeps
 * the Preview sprite's `texture` current; pieces adopt the same handle — the
 * GPU texture updates in place each frame, so one write per piece per stream
 * start is all the sharing costs.
 */
const shareVideoTextureSystem = defineSystem(
    [Query(Sprite, Video), Query(Mut(Sprite), PuzzlePiece)],
    (preview, pieces) => {
        let texture = 0;
        for (const [, sprite] of preview) {
            texture = sprite.texture;
            break;
        }
        if (!texture) return; // first frame not decoded yet
        for (const [, sprite] of pieces) {
            if (sprite.texture !== texture) sprite.texture = texture;
        }
    },
    { name: 'ShareVideoTextureSystem' },
);

const swapTilesSystem = defineSystem(
    [Res(Input), Res(UICameraInfo), Query(Mut(Sprite), Mut(PuzzlePiece))],
    (input, camera: UICameraData, pieces) => {
        if (!camera.valid || !input.isMouseButtonPressed(0)) return;

        if (solved) { // any click deals a new board
            const tiles = shuffledTiles();
            for (const [, sprite, piece] of pieces) {
                piece.tile = tiles[piece.slot];
                const uv = tileUv(piece.tile);
                sprite.uvOffset = uv.offset;
                sprite.uvScale = uv.scale;
                sprite.color = NORMAL_TINT;
            }
            solved = false;
            return;
        }

        const half = (TILE + GAP) / 2;
        let clickedSlot = -1;
        for (const [, , piece] of pieces) {
            if (Math.abs(camera.worldMouseX - slotX(piece.slot)) <= half &&
                Math.abs(camera.worldMouseY - slotY(piece.slot)) <= half) {
                clickedSlot = piece.slot;
                break;
            }
        }
        if (clickedSlot < 0) return;

        if (selectedSlot < 0) {
            selectedSlot = clickedSlot;
        } else if (selectedSlot !== clickedSlot) {
            // Swap which region the two pieces sample.
            let a: { tile: number } | null = null;
            let b: { tile: number } | null = null;
            for (const [, , piece] of pieces) {
                if (piece.slot === selectedSlot) a = piece;
                if (piece.slot === clickedSlot) b = piece;
            }
            if (a && b) {
                [a.tile, b.tile] = [b.tile, a.tile];
            }
            selectedSlot = -1;
        } else {
            selectedSlot = -1; // clicking the selection again deselects
        }

        let allHome = true;
        for (const [, sprite, piece] of pieces) {
            const uv = tileUv(piece.tile);
            sprite.uvOffset = uv.offset;
            sprite.uvScale = uv.scale;
            if (piece.tile !== piece.slot) allHome = false;
            sprite.color = piece.slot === selectedSlot ? SELECTED_TINT : NORMAL_TINT;
        }
        if (allHome) {
            solved = true;
            for (const [, sprite] of pieces) sprite.color = SOLVED_TINT;
        }
    },
    { name: 'SwapTilesSystem' },
);

addSystemToSchedule(Schedule.Update, spawnBoardSystem);
addSystemToSchedule(Schedule.Update, shareVideoTextureSystem);
addSystemToSchedule(Schedule.Update, swapTilesSystem);
