import {
    defineSystem, Query, Mut, Res, Commands,
    Transform, Sprite, Time,
} from 'esengine';
import { Coin, Player } from '../components';
import { game, COIN_SPOTS } from '../state';

const COIN_SIZE = 24;
const PICKUP_DIST = 34;
const COIN_POINTS = 10;

// Coin entities are a pure projection of `game.collected`: spots not yet
// collected get an entity, collected ones lose theirs. Load/Clear only mutate
// the state and this system reconciles the world — no special respawn paths.
export const coinSyncSystem = defineSystem(
    [Query(Coin), Commands()],
    (coins, cmds) => {
        const present = new Set<number>();
        for (const [entity, coin] of coins) {
            if (game.collected.has(coin.index)) cmds.despawn(entity);
            else present.add(coin.index);
        }

        COIN_SPOTS.forEach((spot, index) => {
            if (game.collected.has(index) || present.has(index)) return;
            cmds.spawn()
                .insert(Transform, { position: { x: spot.x, y: spot.y, z: 0 } })
                .insert(Sprite, {
                    size: { x: COIN_SIZE, y: COIN_SIZE },
                    color: { r: 0.98, g: 0.8, b: 0.2, a: 1 },
                })
                .insert(Coin, { index, phase: index * 0.7 });
        });
    },
    { name: 'CoinSyncSystem' }
);

export const coinCollectSystem = defineSystem(
    [Query(Transform, Player), Query(Transform, Coin)],
    (players, coins) => {
        for (const [_player, playerTf] of players) {
            for (const [_coin, coinTf, coin] of coins) {
                if (game.collected.has(coin.index)) continue;
                const dx = playerTf.position.x - coinTf.position.x;
                const dy = playerTf.position.y - coinTf.position.y;
                if (dx * dx + dy * dy > PICKUP_DIST * PICKUP_DIST) continue;

                game.collected.add(coin.index);
                game.score += COIN_POINTS;
                game.status = game.collected.size === COIN_SPOTS.length
                    ? 'All coins collected — Save, then Clear or reload to compare.'
                    : `Collected ${game.collected.size}/${COIN_SPOTS.length} coins.`;
            }
        }
    },
    { name: 'CoinCollectSystem' }
);

export const coinPulseSystem = defineSystem(
    [Query(Mut(Transform), Mut(Coin)), Res(Time)],
    (coins, time) => {
        for (const [_entity, transform, coin] of coins) {
            coin.phase += time.delta * 4;
            const s = 1 + 0.12 * Math.sin(coin.phase);
            transform.scale.x = s;
            transform.scale.y = s;
        }
    },
    { name: 'CoinPulseSystem' }
);
