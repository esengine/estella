# What a sample maintains when nothing has happened

A stationary sample at 100,000 entities and 32 connections costs 3,573 µs, and
`bench/interest-floor` accounts for 3,439 of it in the visibility pass. This asks
what the OTHER work costs: reconciling the registry against its topology journal,
refreshing an owner index nobody changed, gating a change journal, reading empty
removal windows, and giving three kinds of reader a new floor.

The hypothesis it was built to test: that a replication server pays rent per
REPLICATED COMPONENT rather than per entity, so a wide schema costs a stationary
server what a busy one costs.

`node bench/idle-maintenance/probe.mjs`

## It costs about a microsecond

| | µs per sample |
|---|---|
| R registry topology read | 0.1 |
| O owner write-journal read | 0.1 |
| Dc Changed gate, one `anyChangedSince` per component | 0.2 |
| Dr Removed-history read, one window per component | 0.2 |
| Ac advance Removed readers, one per component | 0.3 |
| Ar advance the topology reader | 0.2 |
| Ao advance the write reader | 0.2 |
| K ack and bookkeeping | 0.6 |

Timed a second way, inside the real server rather than in a transcription:
reconcile **0.4 µs**, owner refresh **0.1 µs**, dirty collection **0.8 µs**.
Both say the same thing.

## The schema-width rent is real and it is a rounding error

Same world, same connections, nothing happening, only the number of replicated
components moving:

| replicated components | whole idle pass |
|---|---|
| 2 | 1.4 µs |
| 6 | 2.8 µs |
| 18 | 4.1 µs |
| 66 | **4.7 µs** |

It grows — and sub-linearly, because a component no entity carries answers its
gate faster. Sixty-six replicated components cost **4.7 µs against a 3,573 µs
stationary sample**. There is nothing here to collect.

## The one thing that did cost 108 µs

The first run of this probe reported `R` at 108 µs and `Ar` at 29 µs, reading and
advancing an EMPTY topology window. Both vanished when the idle server whose
table it borrowed was disposed first.

A server that never samples never advances its floors, so its claim pins the
journal at the tick it was created — and a second holder then reads every window
as if it were the whole run. That is a property worth knowing about the
reader-owned journals: **an idle claimant makes everyone else's reads expensive**,
and it is invisible until someone measures with two readers in the room.

## What this does not cover

- The journals are exercised with nothing in them. What a window costs to read
  when it HOLDS rows is the dirty path, measured in `bench/replication-routing`.
- One server, one claim per replicated component. A host running several servers
  against one world would have several, and the min-reader arithmetic behind
  retention is where that would show.
