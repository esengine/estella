import { addSystemToSchedule, Schedule } from 'esengine';
import { provisionPawnsSystem, movePawnsSystem, sendInputSystem } from './net';

// Netcode lives on the fixed timestep (the replication cadence): the authority
// provisions + simulates there, the client uplinks input there. All three
// systems self-gate on the Net role, so the same code runs as the listen
// server, a client, or plain offline single-player.
addSystemToSchedule(Schedule.FixedUpdate, provisionPawnsSystem);
addSystemToSchedule(Schedule.FixedUpdate, movePawnsSystem);
addSystemToSchedule(Schedule.FixedUpdate, sendInputSystem);
