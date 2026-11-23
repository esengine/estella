---
section: Changed
commits:
  - feat(water): the Water material shows what an author sets, in groups, and hides what the water writes each frame
  - feat(editor): a water zone or body makes and opens its own Water material from Details, and a material hides the parameters the engine writes
---
**A water's look can be changed from Details.** A Water Zone with no material drew a stock look no file
held, so its colours, surface, ripples and foam could not be changed anywhere; and a Water material listed
about seventy parameters in one list, many of them written by the water every frame (the waves, the
weather, the zone's data, the quality), so an edit to those did nothing. Under a zone's or a body's
material slot, **Create water material** now makes one on the Water shader, sets it, and opens it; with one
set, **Edit material** opens it. The material shows what an author sets, in Colour, Surface, Ripples, Foam,
Detail and Caustics; what the engine writes is hidden (`ui(hidden)` on a shader parameter), and a new
material no longer stores copies of it.
