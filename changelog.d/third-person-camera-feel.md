---
section: Added
commits:
  - "feat(gameplay): give the third-person camera a fight's view: shoulder, lock-on, sprint widening, eased recovery, recentring and hit shake"
---
**The third-person camera gives a fight its view.** `ThirdPersonCamera` can sit over a `shoulder` and draws it in off a
wall beside it; when something comes between it pulls in at once and goes back out eased (`recoverDamping`). With a
`lockRange`, Q locks onto the nearest foe in front: the view turns to keep it ahead and the `ThirdPersonController`
faces it, until it dies or gets away. The view widens while the player sprints (`sprintFov`), swings round behind a
player left to run (`recenterDelay`), and is thrown when the player is hit (`hitShake`).
