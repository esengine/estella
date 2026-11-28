---
section: Added
commits:
  - "feat(gameplay): give action games their feel: stamina, forgiving jumps, sprint, dash, invulnerable frames, poise and hit stop"
---
**Action games get their feel from fields, not code.** A `ThirdPersonController` forgives a jump pressed just before
landing (`jumpBuffer`) or just after walking off an edge (`coyoteTime`), and with a `sprintSpeed` its dodge key is held
to sprint and tapped to dodge. A `PlatformerController2D` dashes (`dashSpeed`, `dashTime`, `dashCooldown`) on Shift or K,
untouchable while it does. A new `Stamina` component is the one bar a sprint, dodge, attack, jump and dash draw on, and an
empty bar refuses them. A dodge clip declares its invulnerable frames as an `invulnerable` window; `Health` gains
`graceTime` after a hit and `poise`, which staggers a target (the `stagger` trigger) and costs a `Hunter` its swing; and
`MeleeAttack.hitStop` holds the game still for a moment when a blow lands.
