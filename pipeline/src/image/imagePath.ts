// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
export type Pt = readonly [number, number];

export const CURVE_STEPS = 20;

export function parsePath(d: string): { points: Pt[]; closed: boolean }[] {
    const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
    const runs: { points: Pt[]; closed: boolean }[] = [];
    let run: Pt[] | null = null;
    let [x, y, sx, sy, lastCx, lastCy] = [0, 0, 0, 0, 0, 0];
    let cmd = '', prev = '', i = 0;
    const num = (): number => {
        const t = tokens[i++];
        if (t === undefined || /[a-zA-Z]/.test(t)) throw new Error(`path ${JSON.stringify(d.slice(0, 60))}: command ${cmd} is short of numbers`);
        return Number(t);
    };
    const start = (): void => {
        if (!run) { run = [[x, y]]; runs.push({ points: run, closed: false }); }
    };
    const curve = (f: (t: number) => Pt): void => {
        start();
        for (let s = 1; s <= CURVE_STEPS; s++) run!.push(f(s / CURVE_STEPS));
    };
    while (i < tokens.length) {
        if (/[a-zA-Z]/.test(tokens[i]!)) cmd = tokens[i++]!;
        else if (!cmd) throw new Error(`path ${JSON.stringify(d.slice(0, 60))} must start with a command`);
        const rel = cmd === cmd.toLowerCase();
        const [ox, oy] = rel ? [x, y] : [0, 0];
        switch (cmd.toUpperCase()) {
            case 'M':
                x = ox + num(); y = oy + num(); sx = x; sy = y;
                run = [[x, y]];
                runs.push({ points: run, closed: false });
                cmd = rel ? 'l' : 'L';
                break;
            case 'L': x = ox + num(); y = oy + num(); start(); run!.push([x, y]); break;
            case 'H': x = ox + num(); start(); run!.push([x, y]); break;
            case 'V': y = oy + num(); start(); run!.push([x, y]); break;
            case 'C': case 'S': {
                const smooth = cmd.toUpperCase() === 'S';
                const [c1x, c1y] = smooth ? (prev === 'C' || prev === 'S' ? [2 * x - lastCx, 2 * y - lastCy] : [x, y]) : [ox + num(), oy + num()];
                const [c2x, c2y, ex, ey] = [ox + num(), oy + num(), ox + num(), oy + num()];
                const [x0, y0] = [x, y];
                curve((t) => {
                    const u = 1 - t;
                    return [u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey];
                });
                [x, y, lastCx, lastCy] = [ex, ey, c2x, c2y];
                break;
            }
            case 'Q': case 'T': {
                const smooth = cmd.toUpperCase() === 'T';
                const [cx, cy] = smooth ? (prev === 'Q' || prev === 'T' ? [2 * x - lastCx, 2 * y - lastCy] : [x, y]) : [ox + num(), oy + num()];
                const [ex, ey] = [ox + num(), oy + num()];
                const [x0, y0] = [x, y];
                curve((t) => {
                    const u = 1 - t;
                    return [u * u * x0 + 2 * u * t * cx + t * t * ex, u * u * y0 + 2 * u * t * cy + t * t * ey];
                });
                [x, y, lastCx, lastCy] = [ex, ey, cx, cy];
                break;
            }
            case 'Z':
                if (runs.length) runs[runs.length - 1]!.closed = true;
                x = sx; y = sy; run = null;
                cmd = '';
                break;
            default:
                throw new Error(`path command ${cmd} is not one this draws; there are M L H V C S Q T Z`);
        }
        prev = cmd.toUpperCase() === 'L' && prev === 'M' ? 'L' : cmd.toUpperCase();
    }
    return runs;
}
