// Mutable demo state. The build system resolves the scene-authored widget
// entities once; the async flows (check / apply / download) mutate the data
// fields; the update system reflects data → widgets each frame. One direction.
import type { Entity, ButtonHandle } from 'esengine';

/** Where the flow is. Only one flow runs at a time (buttons disable while busy). */
export type Phase =
    | 'idle'          // booted, nothing checked yet
    | 'checking'      // checkForUpdate in flight
    | 'up-to-date'    // no newer content
    | 'update-found'  // a plan is staged, awaiting the user to apply
    | 'applying'      // applyUpdate in flight (downloading + verifying)
    | 'updated'       // applied + hot-swapped
    | 'update-failed' // download/integrity failure — rolled back
    | 'downloading'   // loadGroup(pack) in flight
    | 'downloaded';   // pack pulled + bound

/** Summary of a staged update, for the plan line. */
export interface PlanInfo {
    files: number;
    bytes: number;
    from: string;
    to: string;
}

export interface DemoState {
    built: boolean;
    phase: Phase;
    message: string;
    /** 0..1 for the progress fill. */
    progress: number;
    loaded: number;
    total: number;
    plan: PlanInfo | null;
    packBound: boolean[];

    // Scene-authored widget entities, resolved once by the build system.
    statusEntity: Entity;
    planEntity: Entity;
    pctEntity: Entity;
    versionEntity: Entity;
    fillEntity: Entity;
    tiles: Entity[];
    tileMarks: Entity[];

    // Buttons are created into the scene's slots (createButton needs the
    // interaction wiring); their labels are child entities we drive.
    primaryBtn: ButtonHandle | null;
    dlcBtn: ButtonHandle | null;
    primaryLabel: Entity;
    dlcLabel: Entity;
}

const NONE = -1 as unknown as Entity;

export const state: DemoState = {
    built: false,
    phase: 'idle',
    message: '就绪',
    progress: 0,
    loaded: 0,
    total: 0,
    plan: null,
    packBound: [],

    statusEntity: NONE,
    planEntity: NONE,
    pctEntity: NONE,
    versionEntity: NONE,
    fillEntity: NONE,
    tiles: [],
    tileMarks: [],

    primaryBtn: null,
    dlcBtn: null,
    primaryLabel: NONE,
    dlcLabel: NONE,
};

/** True while a flow owns the progress bar — both buttons disable. */
export function isBusy(phase: Phase): boolean {
    return phase === 'checking' || phase === 'applying' || phase === 'downloading';
}
