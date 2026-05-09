# collab-debug — Debugging Server

Server for real-time collaborative debugging. Handles sessions, publishes debug events, and sends state snapshots to new clients.

---

## Local deployment

```bash
npm install
npm start          # listens at port 3000
```

Local development with automatic restart:
```bash
npm install -g nodemon
nodemon server.js
```

---

## Environmental variables

| Env Var Name | Default Value | Description |
|--------------|---------------|-------------|
| `PORT`       | `3000`        | Listening port |

---

## REST API

### `POST /session/create`
Create a session.

**Input body:** `{ "userId": "string" }`  
**Return value:** `{ "sessionId": "uuid" }`

---

### `POST /session/join`
Before establishing Websocket, verify the session is valid.

**Input body:** `{ "sessionId": "string", "userId": "string" }`  
**Return value:** `{ "sessionId", "createdBy", "createdAt", "clientCount" }`  
**Possible errors:** `404` if no such session.

---

### `GET /session/:id`
Debugger endpoint to get session information.

**Return value:** `{ "sessionId", "createdBy", "clientCount", "breakpoints" }`

---

## WebSocket connection

Connect to:
```
ws://your-server?sessionId=xxx&userId=yyy&userName=zzz&userColor=%23a3f21b
```

`userColor` is encoded using the URL format (e.g. `#a3f21b` should become `%23a3f21b`).

Immediately after connecting, server sends the client a `SESSION_SNAPSHOT` with the session data.

---

## Message structure

All messages have the following fields:

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

## Message types

### Client → Server

| Type     | Payload                                  | Description                           |
|----------|------------------------------------------|---------------------------------------|
| `ping`   | `{}`                                     | Keepalive request                     |
| `breakpoint` | `{ file, line, action: "add"/"remove" }` | Create/destroy a breakpoint           |
| `variable-state` | `{ scopes: { local: {}, global: {} } }` | Variable snapshot                    |

### Server → Client

| Type                | Payload                          | Description                           |
|---------------------|----------------------------------|---------------------------------------|
| `pong`              | `{}`                             | Pong                                   |
| `SESSION_SNAPSHOT`  | `{ breakpoints, variables, users }` | Session data after connection         |
| `BREAKPOINT_HIT`    | `{ file, line }`                 | Added a breakpoint                    |
| `BREAKPOINT_REMOVED` | `{ file, line }`                 | Destroyed a breakpoint                |
| `VARIABLE_UPDATE`   | `{ scopes }`                     | Variables were updated                 |
| `USER_JOINED`       | `{}`                             | Another user joined                    |
| `USER_LEFT`         | `{}`                             | Another user has left                  |
| `HOST_CHANGED`      | `{ newHost }`                    | Host has left and now new host controls|
| `ERROR`             | `{ message, originalType }`        | Bad message received                 |

---

## Deployment on Render

1. Commit changes to GitHub.
2. Visit [render.app](https://render.app) → New Project → Deploy from GitHub.
3. Set environment variable: `PORT=3000`.
4. Render assigns a public URL, which can be shared with team.

The websocket address will look like `wss://your-app.render.app?sessionId=...`.

Note: Railway
