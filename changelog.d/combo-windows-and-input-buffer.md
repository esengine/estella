---
section: Added
commits:
  - feat(animation): a clip event with a duration is a window - a melee swing sweeps its anchor's path over its active window, a transition can wait for a window on the clip being left, and a trigger buffers a press for a set time
  - feat(editor): the animator's transition conditions take a window by name, and a trigger parameter has an input buffer in seconds beside it
---
**Combos chain inside the window their clip declares, and an attack press is buffered rather than kept forever.** A
transition condition `{ param: 'combo', op: 'window' }` holds only while the state being left has that window open, a
custom event with a duration on its clip, so a second attack is taken only where the first one allows it, however short
the window. A trigger parameter may carry a `buffer` in seconds: a press is remembered that long for a transition to use
and then dropped, so a press a little before the window still chains, and a button mashed during the windup no longer
fires another attack the moment the swing ends. A trigger without a buffer waits until a transition uses it, as before.
The Animator editor shows the window's name in place of a parameter for an **in window** condition and a buffer field
beside each trigger. The Third Person 3D example chains Attack1 into Attack2 with a buffered press, and its attack starts
from the states that may attack rather than from any state, where a press mid-swing restarted the swing.
