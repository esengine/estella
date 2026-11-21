---
section: Fixed
commits:
  - fix(editor): an entity created or moved inside a prefab instance is part of it, so Apply writes it into the prefab and a save keeps it
---
**An entity added inside a prefab instance is applied and saved with it.** An entity created under a prefab instance (from the Create menu, or by an AI agent's scene ops), or moved under one, was not counted as part of the instance: Apply passed over it and re-made the instance without it, so it never reached the prefab, and a saved scene put it under a parent the saved instance no longer lists. It is now an entity the instance adds: Apply writes it into the prefab, the other instances take it, and a save keeps it inside the instance.
