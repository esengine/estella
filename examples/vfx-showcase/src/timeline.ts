export const PERIOD = 9;
export const CHARGE = 3.6;
export const CORE_Y = 2.6;

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
export const easeOutCubic = (v: number): number => 1 - (1 - v) ** 3;
export const easeInCubic = (v: number): number => v ** 3;
export const smooth = (from: number, to: number, v: number): number => {
    const k = clamp01((v - from) / (to - from));
    return k * k * (3 - 2 * k);
};

export const chargeLevel = (t: number): number => clamp01(t / CHARGE) ** 1.6;
export const shockRadius = (since: number): number => 13 * easeOutCubic(clamp01(since / 0.95));
export const heatAfter = (since: number): number => (since < 0 ? 0 : Math.exp(-since * 0.55) * clamp01(since / 0.1));
