---
section: Fixed
commits:
  - feat(water): couple breaking surf and lens immersion to the wave field
---
**Breaking waves and half-submerged cameras follow the same surface.** Water carries swell onto beaches and exposes each crest and its shoreward direction to particle effects. Directional spread bends the same crest field for rendering, water queries and lighting. A half-submerged lens samples the rendered wave elevation and the displaced face when switching between air and water.
