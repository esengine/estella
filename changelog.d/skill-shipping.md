---
section: Added
commits:
  - docs(skills): estella-shipping teaches an agent how to take a game out of the editor - the preflight, export_game per platform, compression and size limits, what each platform needs, and proving the build runs on its target through a development build the editor can see
---
**An agent working through the editor's MCP now has a shipping skill.** `skill_guide { skill: "estella-shipping" }` walks an export from start to finish. It starts with saving and running the Build dialog's preflight (`get_project_health`), then `export_game` for the web, desktop, WeChat and the other mini-games, playable ads, Android or iOS, including when a blocker may be acknowledged. It covers turning compression on for a release, reading the package size against each platform's limit (WeChat's 4 MB main package, an ad network's playable limit), and what each platform needs: an http origin, an AppID, the mobile runtime template, no `BigInt64Array` in mini-game code. It ends with proving the build runs where it ships: a development build with the debug channel shows up in `device_targets`, where its screen, frames, frame time and hot-update revision can be read.
