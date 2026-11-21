---
section: Changed
commits:
  - feat(editor): AI agents can connect from the first launch, and can only read until allowed to change the project
---
**AI agents can connect from the first launch.** **Allow AI agents to connect** (Settings > AI Agents) is now on by default, so someone new to the editor can ask an AI tool for help without first finding a switch. It opens a local-only port behind a token, and a connected agent can only read the project until you let it change things in Connect an AI tool. Turn it off to have nothing listening.
