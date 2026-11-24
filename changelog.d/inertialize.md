---
section: Added
commits:
  - feat(animation): a transition can blend by inertia
  - feat(animator): a transition can choose to inertialize
---
**An animator transition can blend by inertia instead of crossfading.** A transition's `blend`, or a controller's `transitionBlend` for every transition that does not say, takes `inertialize`: the state entered plays at once, and each joint's offset from where the last frame left it is carried down to nothing over the transition's duration along a curve that starts with the speed the joint had and arrives with none. The character is never in two motions at once, so a foot does not skim the ground between two gaits' footfalls. It applies to the base layer. On the character it was made for, starting to walk slid a planted foot 3.9 units against 17.8 crossfaded. A stride warp also no longer lets a stride back out to the clip's on the last frame a character moves before it stops.
