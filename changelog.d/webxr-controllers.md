---
section: Added
commits:
  - feat(xr): VR controllers as input, and entities that follow the controllers and the head
---
**VR controllers work as input and can hold things.** In a headset, the controllers' buttons and sticks are input per hand:
`input.isXRButtonPressed(XRButton.Trigger, 'right')`, `getXRAxis(XRAxis.ThumbstickY, 'left')`. Actions can be bound to them
with `XrButton(button, hand)` and `XrStick(hand)`, and a rebind listens to them too. The controllers are also gamepads 1000
(left) and 1001 (right), so existing gamepad bindings can use them. An entity with the new `XRController`
component is placed at a controller every frame, at its grip (to draw a hand or hold an object) or at its aim (to cast a
ray). One with `XRHead` follows the player's head. Both move through the same standpoint as the eyes, after the game's
Update, so a hand does not trail a walking player. Outside a headset they stay where the scene put them. A guide, VR headsets,
is in the camera docs.
