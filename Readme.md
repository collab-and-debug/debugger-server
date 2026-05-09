# Collab Debugger Server

The backend for the [Collab Debugger Dashboard](https://github.com/collab-and-debug/debugger-dashboard). A Node.js server that manages shared debug sessions over HTTP REST and WebSocket, with Redis for persistence and pub/sub across multiple server instances.

---

## What It Does

- **Creates and manages debug sessions** identified by a UUID
- **WebSocket connections** for real-time event broadcasting (breakpoints, variables, user presence)
- **Redis-backed session state** — breakpoints, variables, and users persist across reconnects with a 24-hour TTL
- **Pub/Sub via Redis** — supports horizontal scaling across multiple server instances
- **Heartbeat pings** every 30 seconds to detect and clean up dead connections
- **Host reassignment** — if the session creator leaves, host is transferred to the next user
- **Auto session cleanup** — empty sessions are deleted after 5 seconds

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (CommonJS) |
| HTTP Server | Express 5 |
| WebSocket | `ws` library |
| Session store | Redis (via `ioredis` + `redis`) |
| Pub/Sub | Redis `pSubscribe` |
| Session IDs | `uuid` v4 |
| CORS | `cors` middleware |
| Deployment | Render |

---

## Project Structure

```
debugger-server/
├── server.js                        # Main entry — HTTP + WebSocket server
├── package.json
├── test.js                          # Quick manual test
├── src/
│   ├── Controllers/
│   │   └── sessionController.js     # HTTP route handlers (legacy/utility)
│   ├── Managers/
│   │   ├── sessionManager.js        # In-memory session Map (legacy)
│   │   └── broadcastManager.js      # In-memory broadcast (legacy)
│   ├── Schemas/
│   │   ├── sessionSchema.js         # Session shape definition
│   │   └── eventSchema.js           # Incoming WS event validator
│   └── utils/
│       ├── parseEvent.js            # Parses and validates raw WS messages
│       └── generateId.js            # (reserved)
└── tests/
    ├── tests-breakpoint.js          # Breakpoint add/remove test
    ├── tests-variable.js            # Variable update test
    ├── ws-test.js                   # Basic WebSocket connection test
    ├── test-prod.js                 # Production smoke test
    ├── test-stress.js               # Stress test
    ├── test-loadtest.js             # Load test
    ├── test-latencytest.js          # Latency test
    └── test-memoryleak.js           # Memory leak test
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- A running Redis instance (local or hosted — e.g. Redis Cloud, Upstash)

### 1. Clone the repo

```bash
git clone https://github.com/collab-and-debug/debugger-server.git
cd debugger-server
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env` file in the root:

```env
PORT=3000
REDIS_URL=redis://localhost:6379
```

> For a hosted Redis instance (e.g. Redis Cloud), use:
> ```env
> REDIS_URL=rediss://username:password@your-redis-host:6380
> ```

### 4. Start the server

```bash
npm start
```

Server runs at `http://localhost:3000` and WebSocket at `ws://localhost:3000`.

---

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | HTTP port to listen on | `3000` |
| `REDIS_URL` | Redis connection URL | required |

---

## REST API

### `POST /session/create`

Creates a new debug session.

**Request body:**
```json
{ "userId": "Aishwarya" }
```

**Response `201`:**
```json
{ "sessionId": "550e8400-e29b-41d4-a716-446655440000" }
```

---

### `POST /session/join`

Validates that a session exists before a user joins.

**Request body:**
```json
{ "sessionId": "550e8400-e29b-41d4-a716-446655440000", "userId": "Raj" }
```

**Response `200`:**
```json
{
  "message": "Joined successfully",
  "sessionId": "550e8400-...",
  "createdBy": "Aishwarya",
  "createdAt": 1715000000000,
  "clientCount": 1
}
```

**Response `404`:** Session not found

---

### `GET /session/:id`

Returns current session metadata.

**Response `200`:**
```json
{
  "sessionId": "550e8400-...",
  "createdBy": "Aishwarya",
  "createdAt": 1715000000000,
  "userCount": 2,
  "breakpoints": [{ "file": "index.js", "line": 42, "userName": "Raj" }]
}
```

---

## WebSocket API

Connect with query parameters:

```
ws://localhost:3000?sessionId=<id>&userId=<id>&userName=<name>&userColor=%23f87171
```

> `userColor` must be URL-encoded (e.g. `#f87171` → `%23f87171`)

---

### Messages: Client → Server

#### `breakpoint` — Add or remove a breakpoint

```json
{
  "type": "breakpoint",
  "sessionId": "550e8400-...",
  "userId": "userA",
  "userName": "Aishwarya",
  "userColor": "#f87171",
  "payload": { "file": "index.js", "line": 42, "action": "add" },
  "timestamp": "2026-05-09T10:00:00.000Z"
}
```

> `action` is either `"add"` or `"remove"`

---

#### `variable-state` — Send current variable scopes

```json
{
  "type": "variable-state",
  "sessionId": "550e8400-...",
  "userId": "userA",
  "userName": "Aishwarya",
  "userColor": "#f87171",
  "payload": {
    "scopes": {
      "local": { "x": 42, "isActive": true },
      "global": { "count": 7 }
    }
  },
  "timestamp": "2026-05-09T10:00:00.000Z"
}
```

---

#### `ping` — Keep-alive check

```json
{ "type": "ping" }
```

---

### Messages: Server → Client

#### `SESSION_SNAPSHOT` — Sent immediately on connect

```json
{
  "type": "SESSION_SNAPSHOT",
  "payload": {
    "breakpoints": [...],
    "variables": {...},
    "presentUsers": [...]
  }
}
```

#### `BREAKPOINT_HIT` — A breakpoint was added

```json
{
  "type": "BREAKPOINT_HIT",
  "userName": "Aishwarya",
  "userColor": "#f87171",
  "payload": { "file": "index.js", "line": 42 }
}
```

#### `BREAKPOINT_REMOVED` — A breakpoint was removed

```json
{
  "type": "BREAKPOINT_REMOVED",
  "payload": { "file": "index.js", "line": 42 }
}
```

#### `VARIABLE_UPDATE` — Variable scopes updated

```json
{
  "type": "VARIABLE_UPDATE",
  "payload": { "scopes": { "local": { "x": 42 } } }
}
```

#### `USER_JOINED` — A user connected

```json
{ "type": "USER_JOINED", "userName": "Raj", "userColor": "#60a5fa" }
```

#### `USER_LEFT` — A user disconnected

```json
{ "type": "USER_LEFT", "userName": "Raj" }
```

#### `HOST_CHANGED` — Session host reassigned

```json
{ "type": "HOST_CHANGED", "payload": { "newHost": "userB" } }
```

#### `ERROR` — Something went wrong

```json
{
  "type": "ERROR",
  "payload": { "message": "Invalid JSON", "originalType": null }
}
```

#### `pong` — Response to ping

```json
{ "type": "pong" }
```

---

## Running Tests

Each test file is standalone. Run them while the server is running locally:

```bash
# Start the server first
npm start

# In another terminal, run any test
node tests/tests-breakpoint.js
node tests/tests-variable.js
node tests/ws-test.js
node tests/test-stress.js
node tests/test-loadtest.js
node tests/test-latencytest.js
```

---

## Deployment on Render

1. Push to GitHub
2. Go to [render.com](https://render.com) → **New Web Service** → connect your repo
3. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Add environment variables under **Environment**:
   - `REDIS_URL` → your Redis connection string
   - `PORT` → leave blank (Render sets this automatically)
5. Deploy

> CORS is pre-configured to allow `*.vercel.app` and `localhost:5173`.

---

## Session Lifecycle

```
POST /session/create  →  session stored in Redis (TTL: 24h)
WebSocket connect     →  user added, SESSION_SNAPSHOT sent
breakpoint/variable   →  state updated in Redis, broadcast to all clients
WebSocket disconnect  →  user removed, USER_LEFT broadcast
                         if last user → session deleted after 5s
                         if host left → HOST_CHANGED broadcast
```

---

## License

MIT
