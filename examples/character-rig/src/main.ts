/**
 * @file    main.ts
 * @brief   Character Rig — one clip set, two skeletons nobody named the same way.
 *
 * @details The hero is a Rigify skeleton (`DEF-upper_arm.L`) and the clips were
 *          authored on it. The knight is a different artist's rig (`upperarm.l`),
 *          a head shorter, and owns no clips at all: its `.esavatar` maps the
 *          hero's joint paths onto its own and restates each pose from its own
 *          bind pose.
 *
 *          `speed` against `stance` is a plane rather than two lines, because
 *          crouch-walking is a clip of its own and not the average of walking
 *          and crouching. `reach` bends the right arm onto the head, which no
 *          clip does — and the constraint names joints the way a clip does, so
 *          the avatar translates it for the knight too.
 *
 *          Controls: hold W to run · hold C to crouch · hold Space to reach.
 */
import { addSystemToSchedule, Schedule } from 'esengine';

import { driveSystem } from './systems/drive';

addSystemToSchedule(Schedule.Update, driveSystem);
