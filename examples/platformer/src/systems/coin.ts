import {
    defineSystem, Query, Mut, Res, Time, Transform, Commands,
} from 'esengine';
import { Coin, Player, ScoreDisplay } from '../components';

const COLLECT_DISTANCE = 30;
const BOB_SPEED = 3;
const BOB_AMOUNT = 6;

export const coinSystem = defineSystem(
    [
        Query(Mut(Transform), Mut(Coin)),
        Query(Transform, Player),
        Query(Mut(ScoreDisplay)),
        Res(Time),
        Commands(),
    ],
    (coins, players, scores, time, cmds) => {
        let playerX = 0;
        let playerY = 0;
        let hasPlayer = false;

        for (const [_entity, t, _p] of players) {
            playerX = t.position.x;
            playerY = t.position.y;
            hasPlayer = true;
        }

        for (const [entity, transform, coin] of coins) {
            coin.bobTimer += time.delta * BOB_SPEED;
            transform.position.y = coin.baseY + Math.sin(coin.bobTimer) * BOB_AMOUNT;

            if (hasPlayer) {
                const dx = transform.position.x - playerX;
                const dy = transform.position.y - playerY;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < COLLECT_DISTANCE) {
                    cmds.despawn(entity);
                    for (const [_e, score] of scores) {
                        score.score += 1;
                    }
                }
            }
        }
    },
    { name: 'CoinSystem' }
);
