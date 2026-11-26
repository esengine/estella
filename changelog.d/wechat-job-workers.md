---
section: Added
commits:
  - feat(minigame): carry the engine's job workers in WeChat packages
---
**WeChat mini-games run the engine's background work on a worker.** A WeChat export now writes `workers/index.js` with the job
workers its content needs (world planning for WorldGen, Foliage and planets, `.esimage` drawing, `.essound` / `.esmusic`
rendering, water zone baking), names the directory in `game.json`, and starts it at boot, so that work no longer competes with the
game's frames on the main thread. WeChat allows one worker, so every kind shares it. On a base library older than 2.20.2, or when
iOS takes the worker back, the same work runs on the main thread inside the frame budget. KTX2 transcoding stays on the main thread
on mini-games. Other mini-game hosts carry no workers until their worker API has been checked on a device.
