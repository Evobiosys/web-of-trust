# Open threads

Work identified and agreed but not yet started. Tracked here so it isn't lost
between sessions.

## 1. Guest-as-origin-node (recursive QR onboarding)

**Status:** open — not started.

**What:** Today a self-sovereign guest who scans an origin's QR generates its own
keys in the browser and, once approved, can chat with that origin. The next step
is to make the guest a *full origin node itself*: once connected, the guest can
**show its own QR** so a third person can connect to *it* — not just chat with the
one origin.

This is the recursion of the designer's `strip-to-core` framing — *"the core is two DIDs
connecting, with a QR establishing the first connection; everything else sits on
top of that."* Each connected device becomes able to originate its own
connections.

**Scope (what the guest still needs):**
- **Show my code** — render the guest's *own* connect QR (its own DID + relay),
  reusing the connect-URL builder (`apps/mobile-ui/src/screens/meet.js`).
- **Accept inbound CONNECT** — the guest's relay client
  (`packages/browser-agent/relay_client.js`) currently only handles inbound `DM`
  from the origin; it must also handle inbound `CONNECT` envelopes from third
  parties, surface a consent prompt, and send `CONNECT_ACK` on approval.
- **Multi-peer chat** — the guest chat
  (`apps/mobile-ui/src/screens/guest_chat.js`) is single-thread against the one
  origin; it needs to hold threads with multiple peers.

**Note:** the origin owner they scanned is *not* connecting them into a trust
community — that origin is simply the first node. The guest then has the power to
connect with others on their own.

**Not doing:** questhub redeploy (dropped).
