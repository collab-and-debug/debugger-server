# collab-debug — Debugging Server

Real-time collaborative debugging server. Manages sessions, broadcasts debug events, and delivers state snapshots to late joiners.

---

## Run locally

```bash
npm install
npm start          # runs on port 3000
```

For dev with auto-restart:
```bash
npm install -g nodemon
nodemon server.js
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT`   | `3000`  | Server port |

---

## REST endpoints

### `POST /session/create`
Creates a new session.

**Body:** `{ "userId": "string" }`  
**Response:** `{ "sessionId": "uuid" }`

---

### `POST /session/join`
Validates a session exists before the client opens a WebSocket.

**Body:** `{ "sessionId": "string", "userId": "string" }`  
**Response:** `{ "sessionId", "createdBy", "createdAt", "clientCount" }`  
**Errors:** `404` if session not found

---

### `GET /session/:id`
Debug endpoint — returns current session state.

**Response:** `{ "sessionId", "createdBy", "clientCount", "breakpoints" }`

---

## WebSocket connection

Connect to:
```
ws://your-server?sessionId=xxx&userId=yyy&userName=zzz&userColor=%23a3f21b
```

`userColor` must be URL-encoded (e.g. `#a3f21b` → `%23a3f21b`).

On connect, server immediately sends a `SESSION_SNAPSHOT` with current state.

---

## Event schema

Every message follows this shape:

```json
{
  "type":      "string",
  "seq":       1,
  "sessionId": "uuid",
  "userId":    "string",
  "userName":  "string",
  "userColor": "#hex",
  "payload":   {},
  "timestamp": "ISO8601"
}
```

---

## Event types

### Client → Server

| type | payload | description |
|------|---------|-------------|
| `ping` | `{}` | keepalive check |
| `breakpoint` | `{ file, line, action: "add"/"remove" }` | add or remove a breakpoint |
| `variable-state` | `{ scopes: { local: {}, global: {} } }` | latest variable snapshot |

### Server → Client

| type | payload | description |
|------|---------|-------------|
| `pong` | `{}` | response to ping |
| `SESSION_SNAPSHOT` | `{ breakpoints, variables, users }` | full state on connect |
| `BREAKPOINT_HIT` | `{ file, line }` | breakpoint added |
| `BREAKPOINT_REMOVED` | `{ file, line }` | breakpoint removed |
| `VARIABLE_UPDATE` | `{ scopes }` | variables changed |
| `USER_JOINED` | `{}` | someone connected |
| `USER_LEFT` | `{}` | someone disconnected |
| `HOST_CHANGED` | `{ newHost }` | original host left, new host assigned |
| `ERROR` | `{ message, originalType }` | bad message received |

---

## Deploy to Railway

1. Push repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Set env var: `PORT=3000`
4. Railway gives you a public URL — share with team

WebSocket URL will be: `wss://your-app.railway.app?sessionId=...`  
Note: Railway uses `wss://` (secure) not `ws://` — update your frontend hook URL accordingly.