# Project Retrospective — collab-debug

## What worked

**WebSocket architecture** — splitting broadcast logic into a single `broadcastToSession`
function kept the connection handler clean. Every feature plugged into it the same way.

**Session snapshot pattern** — storing breakpoints and variables server-side and
sending them on connect solved the late-joiner problem cleanly. No special handling
needed on the client side.

**Team split by ownership** — having one person own backend, one own dashboard,
one own VS Code extension meant no merge conflicts on the critical path.

## What didn't work

**No persistence** — server restart wipes all sessions. For a real product
this would need Redis or a database. During testing we lost sessions when
Railway redeployed.

**URL-encoded user color** — passing userColor as a query param caused bugs
because `#` in hex codes breaks URL parsing. Should have sent identity
in the first WebSocket message instead of the connection URL.

**Testing was too late** — we only did end-to-end testing on Day 6.
Should have had a shared test session running from Day 3 so bugs
surfaced earlier.

## What we'd change

- Move user identity to first WS message, not query params
- Add Redis for session persistence across restarts
- Add a proper reconnection queue — events sent while client was
  disconnected are currently lost
- Rate limiting on the broadcast — a single bad client can flood the session

## What I personally learned

- WebSocket lifecycle (open, message, close, error, pong) and how they
  interact with cleanup logic
- Why sequence numbers matter in distributed systems — even on a LAN
  messages can arrive out of order
- The snapshot pattern for late joiners — same concept used in
  operational transforms and CRDTs
- How to structure a Node.js server that never crashes — two try/catch
  layers, one for parse, one for business logic