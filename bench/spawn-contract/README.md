# What a spawn payload carries, and under which contract

`spawnPayload_` builds its payload with `serializeEntityComponents` — the SCENE
projection. Scene serialization answers *how is this entity restored in full*.
Replication answers a different question: *which facts is this client authorized
and declared to know*. They have been one function, so a third question has been
answered by accident: *what does a ghost need in order to exist*.

This probe measures nothing. It takes real spawn payloads off the wire and sorts
their components into the contracts they would belong to, so the construction
recipe that is currently implicit can be read.

```
node bench/spawn-contract/probe.mjs
```

It bundles `examples/multiplayer-arena/src/main.ts` against the same SDK
instance and runs the certified example's own provisioning — not a transcription
of its pawn, which would be a probe of this file rather than of the game.

## The census: two pawns, eight components

| component | contract | declared fields | fields sent |
|---|---|---|---|
| `Transform` | **replication table** | position, rotation, scale | position, rotation, scale, **worldPosition, worldRotation, worldScale** |
| `Replicated` | **protocol metadata** | — | netId, owner |
| `Sprite` | **undeclared** | — | **15** — texture, color, size, pivot, uvOffset, uvScale, layer, lit, flipX, flipY, tileSize, tileSpacing, parallax, material, enabled |
| `Pawn` | **undeclared** | — | player, speed |

Half the payload declares nothing, and the half that does sends twice the fields
it declared. The public contract says an empty `replicatedFields` means the
component is never replicated; on this path it is not true.

## The four buckets, and which is which

1. **Replication table** — `Transform`. This is the only part that is under a
   declared contract, and even it over-sends: `worldPosition` and friends are the
   composition's OUTPUT, which the client recomputes from the inputs it was sent.
2. **Protocol metadata** — `Replicated`. `owner` is not a replicated field and
   must not become one; it is protocol identity, like `netId`, which is already
   a top-level field of the payload rather than a component.
3. **Construction, and the client really does need it** — `Sprite`, `Pawn`. The
   arena's own source says so out loud: *"full component payload — sprite color
   included"* and *"`player` rides the spawn payload, so ghosts know who they
   are"*. **The certified example depends on the hole.** These need an explicit
   construction contract, not a silent one.
4. **Server-only, and nothing should have sent it** — nothing in the arena, and
   that is the point: there is no rule stopping it. An AI blackboard, a physics
   scratch component, an unrevealed objective — none declares a replicated field,
   none appears in the handshake schema, and every one of them transits today.

## The gold: `sdk/tests/replication-spawn-contract.test.ts`

One fixture separates all three layers at once:

```
Replicated     protocol identity     netId, owner
Transform      replication baseline  declared fields only
Sprite         ghost construction    client needs it; the authority's VALUE is not its source
ServerSecret   neither               must never leave the authority
```

Two assertions hold today. Three are `it.fails` — they state the contract and
record that it is currently broken, so a fix that lands without flipping them to
`it` turns them red:

| assertion | how it fails today |
|---|---|
| a component that declares nothing is not handed over | `ServerSecret` is on the ghost — `expected true to be false` |
| fields a component did not declare are not handed over | `hidden: 9` arrived — `expected 9 to be +0` |
| the ghost is built from a construction contract | the ghost took the authority's `Sprite.layer` 3, not a declared 7 |

The third is what makes "the ghost has a Sprite" mean something: the archetype's
value is deliberately not the authority's, so the assertion cannot pass by the
payload having copied the server's one.

## What this implies for N5b, before it is written

**The arena has to change.** Today its pawn colours reach clients because the
whole `Sprite` transits. Under an explicit contract the ghost's Sprite comes from
its archetype, so the example must either key colour off the player index in the
archetype, or declare `Sprite.color` replicated and mean it. Same for
`Pawn.player`. That is a migration, and it is the correct one — it turns an
accident the source already documents into a declaration.

## What this does not cover

- One project. The arena is the certified multiplayer example and the only game
  in the tree that replicates entities it spawns at runtime.
- Bucket 3 against bucket 4 is a judgement, not a measurement. The probe reports
  `undeclared` and says which fields; deciding that `Sprite` is construction and
  a blackboard is a leak is the design work this exists to inform.
- It reads the JSON control plane. The binary delta plane already sends declared
  fields only — the hole is the spawn, not the stream.
