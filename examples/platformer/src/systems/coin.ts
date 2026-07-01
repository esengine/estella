import {
    defineSystem, Query, Mut, Res, Time, Transform, Commands,
    PhysicsEvents,
} from 'esengine';
import { Coin, ScoreDisplay } from '../components';

const BOB_SPEED = 3;
const BOB_AMOUNT = 6;

export const coinBobSystem = defineSystem(
    [Query(Mut(Transform), Mut(Coin)), Res(Time)],
    (coins, time) => {
        for (const [_entity, transform, coin] of coins) {
            coin.bobTimer += time.delta * BOB_SPEED;
            transform.position.y = coin.baseY + Math.sin(coin.bobTimer) * BOB_AMOUNT;
        }
    },
    { name: 'CoinBobSystem' }
);

export const coinPickupSystem = defineSystem(
    [Res(PhysicsEvents), Query(Coin), Query(Mut(ScoreDisplay)), Commands()],
    (events, coins, scores, cmds) => {
        for (const ev of events.sensorEnters) {
            let isCoin = false;
            for (const [coinEntity] of coins) {
                if (coinEntity === ev.sensorEntity) { isCoin = true; break; }
            }
            if (!isCoin) continue;

            cmds.despawn(ev.sensorEntity);
            for (const [_entity, score] of scores) score.score += 1;
        }
    },
    { name: 'CoinPickupSystem' }
);
