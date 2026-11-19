---
note: A game server can keep what it holds across restarts
commits:
  - feat(persist): one store for many processes, and writes that go together - PersistStore.transact writes several keys all or none (FileStore through a journal a crash cannot leave half-applied), StoreHub serves any store over WebSockets behind a shared secret and RemoteStore is a store that reaches it, and PlayerPersistence.saveTogether writes several players' records as one
---
