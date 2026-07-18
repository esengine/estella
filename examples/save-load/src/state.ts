export const COIN_SPOTS: ReadonlyArray<{ x: number; y: number }> = [
    { x: -320, y: 40 },
    { x: -160, y: -120 },
    { x: 0, y: 60 },
    { x: 160, y: -120 },
    { x: 320, y: 40 },
    { x: 0, y: -220 },
];

export const game = {
    score: 0,
    collected: new Set<number>(),
    altColor: false,
    status: 'Move with the arrow keys, collect coins, then Save.',
    built: false,
};
