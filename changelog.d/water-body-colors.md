---
section: Added
commits:
  - feat(water): each body of water can have its own colour, blended into its neighbour's where they meet
---
**Each body of water can have its own colour.** A WaterBody's new **Surface Look** keeps the zone water material's colour or uses its own **Water Color**: a muddy river, a green pond and a blue sea in one zone. Where a body with its own colour meets another (a river running into a lake) the two run into each other across the junction, as a transition between their looks. Deep water darkens a body's colour the way the material's deep colour darkens its shallow one, and an ocean's own colour reaches past the zone to the horizon.
