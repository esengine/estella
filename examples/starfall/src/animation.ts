import { ATTACKS, FLOOR, type Trial } from './game';

export interface Pose { atlas: 0 | 1; frame: number; name: string }
// Authored poses, not a translation of the lobby portrait. Eight run frames
// advance by travelled distance; attack frames share the simulation's contact.
export function samplePose(g: Trial, out: Pose): Pose {
    out.atlas = 0;
    if (g.hurt > 0) { out.atlas = 1; out.frame = 15; out.name = 'hurt'; }
    else if (g.charge > 0) { out.atlas = 1; out.frame = 13; out.name = 'charge'; }
    else if (g.nova > .72) { out.atlas = 1; out.frame = 14; out.name = 'nova'; }
    else if (g.dash > 0) { out.atlas = 1; out.frame = 12; out.name = 'dash'; }
    else if (g.slash > 0) {
        const contact = ATTACKS[g.attackStage].contact;
        const frame = g.attackAge < contact * .5 ? 0 : g.attackAge < contact ? 1 : g.attackAge < contact + .10 ? 2 : 3;
        out.atlas = 1; out.frame = g.attackStage * 4 + frame; out.name = 'slash-' + (g.attackStage + 1);
    }
    else if (g.y > FLOOR) { out.frame = g.vy > 0 ? 13 : 14; out.name = g.vy > 0 ? 'jump' : 'fall'; }
    else if (g.landing > 0) { out.frame = 15; out.name = 'land'; }
    else if (g.moving) { out.frame = 4 + Math.floor(g.runTime * 14) % 8; out.name = 'run'; }
    else { out.frame = Math.floor(g.motionTime * 4) % 4; out.name = 'idle'; }
    return out;
}
