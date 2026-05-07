const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// ─── In-memory session store ────────────────────────────
const sessions = new Map();
let messageSequence = 0;

// ─── HTTP + WebSocket server ────────────────────────────
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// ─── REST ROUTES ────────────────────────────────────────

app.post('/session/create', (req, res) => {
  const sessionId = uuidv4();
  const { userId } = req.body;

  sessions.set(sessionId, {
    createdBy:   userId || 'anonymous',
    createdAt:   Date.now(),
    clients:     [],
    users:       [],
    breakpoints: [],
    variables:   {},
  });

  res.status(201).json({ sessionId });
});

app.post('/session/join', (req, res) => {
  const { sessionId, userId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.status(200).json({
    message:     'Joined successfully',
    sessionId,
    createdBy:   session.createdBy,
    createdAt:   session.createdAt,
    clientCount: session.clients.length,
  });
});

app.get('/session/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json({
    sessionId:   req.params.id,
    createdBy:   session.createdBy,
    createdAt:   session.createdAt,
    clientCount: session.clients.length,
    userCount:   session.users.length,
    breakpoints: session.breakpoints,
  });
});

// ─── Helpers ────────────────────────────────────────────

/**
 * Broadcasts a message to all connected clients in a session.
 * @param {string} sessionId - Target session ID
 * @param {object} message - Event object following the standard schema
 * @param {WebSocket|null} excludeClient - Client to skip (usually the sender)
 */
function broadcastToSession(sessionId, message, excludeClient = null) {
  const session = sessions.get(sessionId);
  if (!session) return;

  messageSequence++;
  const payload = JSON.stringify({ ...message, seq: messageSequence });

  session.clients.forEach(client => {
    if (client === excludeClient) return;
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
}

/**
 * Sends a structured error event back to a single client.
 * @param {WebSocket} ws - Client to notify
 * @param {string} sessionId - Session context
 * @param {string} message - Human-readable error description
 * @param {string} originalType - The event type that caused the error
 */
function sendError(ws, sessionId, message, originalType = null) {
  ws.send(JSON.stringify({
    type:      'ERROR',
    sessionId,
    userId:    'server',
    userName:  'server',
    userColor: null,
    payload:   { message, originalType },
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Pings all connected clients every 30s.
 * Terminates clients that do not respond with a pong.
 * @param {WebSocket.Server} wss
 */
function startHeartbeat(wss) {
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
}

startHeartbeat(wss);

// ─── WebSocket ──────────────────────────────────────────

wss.on('connection', (ws, req) => {
  const params    = new URLSearchParams(req.url.replace('/?', ''));
  const sessionId = params.get('sessionId');
  const userId    = params.get('userId');
  const userName  = params.get('userName');
  const userColor = decodeURIComponent(params.get('userColor') || '#888888');

  if (!sessionId) { ws.close(4000, 'sessionId is required'); return; }

  const session = sessions.get(sessionId);
  if (!session) { ws.close(4004, 'Session not found'); return; }

  // reconnection — update ws ref instead of duplicating user entry
  const existingIndex = session.users.findIndex(u => u.userId === userId);
  if (existingIndex !== -1) {
    session.users[existingIndex].ws = ws;
  } else {
    session.users.push({ userId, userName, userColor, ws });
  }

  session.clients.push(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // send full session state to the new joiner
  ws.send(JSON.stringify({
    type:      'SESSION_SNAPSHOT',
    seq:       ++messageSequence,
    sessionId,
    userId:    'server',
    userName:  'server',
    userColor: null,
    payload: {
      breakpoints: session.breakpoints,
      variables:   session.variables,
      users:       session.users.map(u => ({
        userId: u.userId, userName: u.userName, userColor: u.userColor,
      })),
    },
    timestamp: new Date().toISOString(),
  }));

  // notify existing members
  broadcastToSession(sessionId, {
    type: 'USER_JOINED', sessionId, userId, userName, userColor,
    payload: {}, timestamp: new Date().toISOString(),
  }, ws);

  ws.on('message', (raw) => {
    let msg;

    try {
      msg = JSON.parse(raw);
    } catch {
      sendError(ws, sessionId, 'Invalid JSON');
      return;
    }

    if (!msg.timestamp) msg.timestamp = new Date().toISOString();

    try {
      switch (msg.type) {

        case 'ping':
          ws.send(JSON.stringify({
            type: 'pong', sessionId,
            userId: 'server', userName: 'server', userColor: null,
            payload: {}, timestamp: new Date().toISOString(),
          }));
          break;

        case 'breakpoint': {
          const { file, line, action } = msg.payload;
          if (!file || !line || !action) throw new Error('missing file/line/action');

          if (action === 'add') {
            const exists = session.breakpoints.some(b => b.file === file && b.line === line);
            if (!exists) session.breakpoints.push({ file, line, userName: msg.userName, userColor: msg.userColor });
          }
          if (action === 'remove') {
            session.breakpoints = session.breakpoints.filter(
              b => !(b.file === file && b.line === line)
            );
          }

          broadcastToSession(sessionId, {
            type:      action === 'add' ? 'BREAKPOINT_HIT' : 'BREAKPOINT_REMOVED',
            sessionId, userId: msg.userId, userName: msg.userName, userColor: msg.userColor,
            payload:   { file, line },
            timestamp: msg.timestamp,
          }, ws);
          break;
        }

        case 'variable-state': {
          if (!msg.payload?.scopes) throw new Error('missing scopes');
          session.variables = msg.payload.scopes;

          broadcastToSession(sessionId, {
            type:      'VARIABLE_UPDATE',
            sessionId, userId: msg.userId, userName: msg.userName, userColor: msg.userColor,
            payload:   { scopes: msg.payload.scopes },
            timestamp: msg.timestamp,
          }, ws);
          break;
        }

        default:
          break;
      }

    } catch (err) {
      sendError(ws, sessionId, err.message, msg.type);
    }
  });

  ws.on('close', () => {
    session.clients = session.clients.filter(c => c !== ws);
    session.users   = session.users.filter(u => u.userId !== userId);

    if (session.clients.length > 0) {
      broadcastToSession(sessionId, {
        type: 'USER_LEFT', sessionId, userId, userName, userColor,
        payload: {}, timestamp: new Date().toISOString(),
      });
    }

    if (session.createdBy === userId && session.users.length > 0) {
      session.createdBy = session.users[0].userId;
      broadcastToSession(sessionId, {
        type: 'HOST_CHANGED', sessionId,
        userId: 'server', userName: 'server', userColor: null,
        payload: { newHost: session.createdBy },
        timestamp: new Date().toISOString(),
      });
    }

    if (session.clients.length === 0) {
      setTimeout(() => {
        const current = sessions.get(sessionId);
        if (current && current.clients.length === 0) {
          sessions.delete(sessionId);
        }
      }, 5000);
    }
  });

  ws.on('error', (err) => {
    sendError(ws, sessionId, err.message);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));