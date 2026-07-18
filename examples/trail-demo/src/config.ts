/** Lissajous figure the comet rides: center, radii, angular frequencies. */
export const COMET = {
    centerX: -330,
    centerY: 20,
    radiusX: 250,
    radiusY: 200,
    freqX: 3,
    freqY: 2,
    speed: 0.55,
};

/** Follower chase stiffness — larger closes the gap to the cursor faster. */
export const FOLLOW_STIFFNESS = 9;

export const DASHER_HOME = { x: 330, y: -140 };

/** One dash's flight time in seconds — short and fast so the burst reads. */
export const DASH_DURATION = 0.14;

export const COMET_SIZE = 22;
export const FOLLOWER_SIZE = 16;
export const DASHER_SIZE = 30;
