---
section: Changed
commits:
  - feat(examples): animate Starfall combat and illuminate skills
---
**Starfall now animates the swordsman and stages each skill from anticipation to impact.** The Estella 2D action example keeps its lobby portrait and uses separate sprite sheets for an eight-frame run, jumping, landing, a three-hit sword chain, dash, charge, release and hurt poses. Sword contact now controls damage, impact holds, knockback and front-projectile deflection. Pooled afterimages, a charging floor sigil, expanding nova, enemy break effects and a single background material add motion and skill-driven illumination without screen-space bloom. The animation textures are GPU compressed for the WeChat package budget; headless input, combat timing and frame-cadence checks cover the example. Physical midrange-phone and WeChat runtime acceptance remains outstanding.
