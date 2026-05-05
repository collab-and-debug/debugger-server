const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  console.log("REQUEST:", req.method, req.url);
  next();
});

// ─── In-memory session store ───────────────────────────
const sessions = new Map();

// ─── HTTP Server (shared with WebSocket) ───────────────
const server = http.createServer(app);

// ─── WebSocket Server ──────────────────────────────────
const wss = new WebSocket.Server({ server });

//  REST ROUTES

app.post('/session/create', (req, res) => {
  const sessionId = uuidv4();
  const { userId } = req.body;

  sessions.set(sessionId, {
    createdBy:   userId || 'anonymous',
    createdAt:   Date.now(),
    clients:     [],           // WebSocket connections
    users:       [],           // { userId, userName, userColor, ws }
    breakpoints: [],           // { file, line, userName, userColor }
    variables:   {},           // { local: {}, global: {} }
  });

  console.log(`[SESSION CREATED] sessionId=${sessionId} by userId=${userId}`);
  res.status(201).json({ sessionId });
});

// POST /session/join
app.post('/session/join', (req, res) => {
  const { sessionId, userId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  console.log(`[SESSION JOINED] sessionId=${sessionId} by userId=${userId}`);
  res.status(200).json({
    message: 'Joined successfully',
    sessionId,
    createdBy: session.createdBy,
    createdAt: session.createdAt,
    clientCount: session.clients.length
  });
});

// GET /session/:id  (debug - see session state)
app.get('/session/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({
    sessionId: req.params.id,
    createdBy: session.createdBy,
    createdAt: session.createdAt,
    clientCount: session.clients.length
  });
});

// ─── Broadcast to all clients in session except sender ─
function broadcastToSession(sessionId, message, excludeClient = null) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const payload = JSON.stringify(message);

  session.clients.forEach(client => {
    if (client === excludeClient) return;
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

//  WEBSOCKET
wss.on('connection', (ws, req) => {
  const params    = new URLSearchParams(req.url.replace('/?', ''));
  const sessionId = params.get('sessionId');
  const userId    = params.get('userId');
  const userName  = params.get('userName');
  const userColor = decodeURIComponent(params.get('userColor') || '#888888');

  // ── Validate ────────────────────────────────────────────
  if (!sessionId) {
    ws.close(4000, 'sessionId is required');
    return;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    ws.close(4004, 'Session not found');
    return;
  }

  // ── Handle reconnection — same userId rejoining ─────────
  const existingUserIndex = session.users.findIndex(u => u.userId === userId);
  if (existingUserIndex !== -1) {
    // update their ws reference, don't add duplicate
    session.users[existingUserIndex].ws = ws;
    console.log(`[WS RECONNECT] userId=${userId} rejoined sessionId=${sessionId}`);
  } else {
    session.users.push({ userId, userName, userColor, ws });
  }

  // ── Add ws to clients list ───────────────────────────────
  session.clients.push(ws);
  console.log(`[WS CONNECT] sessionId=${sessionId} userId=${userId} | clients=${session.clients.length}`);

  // ── Send snapshot to this new joiner ────────────────────
  ws.send(JSON.stringify({
    type:      'SESSION_SNAPSHOT',
    sessionId,
    userId:    'server',
    userName:  'server',
    userColor: null,
    payload: {
      breakpoints: session.breakpoints,
      variables:   session.variables,
      users:       session.users.map(u => ({
        userId:    u.userId,
        userName:  u.userName,
        userColor: u.userColor,
      })),
    },
    timestamp: new Date().toISOString(),
  }));

  // ── Broadcast user-joined to everyone else ───────────────
  broadcastToSession(sessionId, {
    type:      'USER_JOINED',
    sessionId,
    userId,
    userName,
    userColor,
    payload:   {},
    timestamp: new Date().toISOString(),
  }, ws);

  // ── Handle incoming messages ─────────────────────────────
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.error(`[WS BAD JSON] sessionId=${sessionId}`);
      return;
    }

    if (!msg.timestamp) msg.timestamp = new Date().toISOString();
    console.log(`[WS MESSAGE] type=${msg.type} sessionId=${sessionId} userId=${userId}`);

    switch (msg.type) {

      // ── Ping — just reply, don't broadcast ──────────────
      case 'ping':
        ws.send(JSON.stringify({
          type:      'pong',
          sessionId,
          userId:    'server',
          userName:  'server',
          userColor: null,
          payload:   {},
          timestamp: new Date().toISOString(),
        }));
        break;

      // ── Breakpoint add/remove ────────────────────────────
      case 'breakpoint': {
        const { file, line, action } = msg.payload;

        if (action === 'add') {
          const exists = session.breakpoints.some(
            b => b.file === file && b.line === line
          );
          if (!exists) {
            session.breakpoints.push({
              file,
              line,
              userName:  msg.userName,
              userColor: msg.userColor,
            });
          }
        }

        if (action === 'remove') {
          session.breakpoints = session.breakpoints.filter(
            b => !(b.file === file && b.line === line)
          );
        }

        broadcastToSession(sessionId, {
          type:      action === 'add' ? 'BREAKPOINT_HIT' : 'BREAKPOINT_REMOVED',
          sessionId,
          userId:    msg.userId,
          userName:  msg.userName,
          userColor: msg.userColor,
          payload:   { file, line },
          timestamp: msg.timestamp,
        }, ws);
        break;
      }

      // ── Variable state — store + broadcast ───────────────
      case 'variable-state': {
        // overwrite with latest
        session.variables = msg.payload.scopes;

        broadcastToSession(sessionId, {
          type:      'VARIABLE_UPDATE',
          sessionId,
          userId:    msg.userId,
          userName:  msg.userName,
          userColor: msg.userColor,
          payload:   { scopes: msg.payload.scopes },
          timestamp: msg.timestamp,
        }, ws);
        break;
      }

      // ── Unknown type — log and ignore ────────────────────
      default:
        console.warn(`[WS UNKNOWN TYPE] type=${msg.type}`);
    }
  });

  // ── Disconnect ───────────────────────────────────────────
  ws.on('close', () => {
    session.clients = session.clients.filter(c => c !== ws);

    // remove from users list
    session.users = session.users.filter(u => u.userId !== userId);

    console.log(`[WS DISCONNECT] sessionId=${sessionId} userId=${userId} | remaining=${session.clients.length}`);

    // broadcast user-left to remaining clients
    broadcastToSession(sessionId, {
      type:      'USER_LEFT',
      sessionId,
      userId,
      userName,
      userColor,
      payload:   {},
      timestamp: new Date().toISOString(),
    });

    // cleanup empty session
    if (session.clients.length === 0) {
      sessions.delete(sessionId);
      console.log(`[SESSION DELETED] sessionId=${sessionId}`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS ERROR] sessionId=${sessionId} userId=${userId} | ${err.message}`);
  });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});