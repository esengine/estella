---
section: Added
commits:
  - "feat(gameplay): make enemy swings readable: windup, strike and recover, a telegraph colour, commitment and turns"
---
**An enemy's swing can be read and dodged.** A `Hunter` swing now goes through `windup`, `strike` and `recover`
(the engine-written `phase`). With a `windup` above 0 the hunter times the swing itself and lands it through its
`MeleeAttack` with no attack clip; at 0 its clip's `attack-active` window times it as before. It keeps turning to the
player while it winds up and not after, so a sidestep or a roll beats it, and it carries a swing through rather than
chasing mid-blow. A `telegraphColor` flushes its meshes and sprites as it winds up, `recover` is the opening to hit
back, `maxAttackers` makes a crowd take turns, and a stagger cancels the swing.
