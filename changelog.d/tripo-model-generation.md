---
section: Added
commits:
  - feat(editor): agents generate 3D models with Tripo AI - tripo_generate makes a textured model from a sentence or a picture and imports it as a dropped .glb is, answering the prefab to place and Tripo's preview; tripo_task picks up a generation that outlasted the call without spending again, tripo_balance shows the credits left, and the API key is entered in Settings > Tools and AI > AI Agents and sealed in the keychain, read only by the main process at the request
---
**AI agents can generate 3D models with Tripo AI.** The editor's new `tripo` tool group makes a textured model from a sentence or a picture and imports it like a dropped `.glb`, so the agent gets a prefab it can place, along with Tripo's preview picture. You add your Tripo API key in Settings > Tools and AI > AI Agents; it is kept in this machine's keychain and never written into the project. Each generation spends credits from your Tripo account, and `tripo_balance` shows how many are left.
