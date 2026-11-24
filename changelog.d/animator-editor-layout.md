---
section: Changed
commits:
  - feat(animator): lay the editor out in three columns, with marked wires and live debugging
  - feat(animation): an animator says what it is playing for an editor to show
---
**The animation controller editor shows a graph you can read and the details of what you picked, and follows the running game.** Parameters and layers sit on the left, the state graph in the middle, and the details of the selected state, transition, layer or constraints on the right, in place of one long column of everything. Wires no longer carry their conditions as text that piled up where wires crossed: each has a round mark with an arrow, several transitions between the same two states are one wire whose mark counts them, and the conditions show on hover (a toolbar box writes them on the wires again). A 1D blend is drawn as its speed axis, with each motion's weight; a transition shows its duration, which could not be set here before, and draws what a crossfade and an inertialized blend do over it; constraint joints are picked from the rig's tree instead of typed as paths. While the game runs, the parameters show their live values and can be set, the state being played fills a progress bar, and a bar under the graph names the state and the blend weights. `AnimatorControllerAPI.debugView(entity)` is what it reads.
