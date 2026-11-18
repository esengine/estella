---
section: Fixed
commits:
  - fix(net): a replication hello over a platform socket fails as soon as the socket closes - connecting to a server that is not there, or one that dies mid-hello, waited out the 10 s request timeout before the client knew; now it knows when the socket does, so a redial or a transfer into a zone that just died moves on at once
---
**A replicated client that connects to a server that is not there finds out at once.** `Net.connect` over a `GameSocket` (or any platform socket) to an address nobody is listening on, or to a server that dies during the hello, used to wait out the full 10-second request timeout before failing, although the socket had already said it was closed. The hello now fails when the socket closes, so a redial moves on to its next attempt and a client transferred into a zone that just crashed can log in somewhere else straight away.
