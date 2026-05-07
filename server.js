const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  console.log('REQUEST:', req.method, req.url);
  next();
});

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

  console.log(`[SESSION CREATED] sessionId=${sessionId} by userId=${userId}`);
  res.status(201).json({ sessionId });
});

app.post('/session/join', (req, res) => {
  const { sessionId, userId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  console.log(`[SESSION JOINED] sessionId=${sessionId} by userId=${userId}`);
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

// ─── Broadcast helper ───────────────────────────────────
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

// ─── Heartbeat ──────────────────────────────────────────
function startHeartbeat(wss) {
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        console.log('[HEARTBEAT] client unresponsive — terminating');
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

  // reconnection — update ws ref instead of duplicating
  const existingIndex = session.users.findIndex(u => u.userId === userId);
  if (existingIndex !== -1) {
    session.users[existingIndex].ws = ws;
    console.log(`[WS RECONNECT] userId=${userId} sessionId=${sessionId}`);
  } else {
    session.users.push({ userId, userName, userColor, ws });
  }

  session.clients.push(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  console.log(`[WS CONNECT] sessionId=${sessionId} userId=${userId} | clients=${session.clients.length}`);

  // snapshot to new joiner
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

  // tell others someone joined
  broadcastToSession(sessionId, {
    type: 'USER_JOINED', sessionId, userId, userName, userColor,
    payload: {}, timestamp: new Date().toISOString(),
  }, ws);

  // ── Messages ─────────────────────────────────────────
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({
        type: 'ERROR', sessionId, userId: 'server', userName: 'server', userColor: null,
        payload: { message: 'Invalid JSON' }, timestamp: new Date().toISOString(),
      }));
      return;
    }

    if (!msg.timestamp) msg.timestamp = new Date().toISOString();

    try {
      switch (msg.type) {

        case 'ping':
          ws.send(JSON.stringify({
            type: 'pong', sessionId, userId: 'server', userName: 'server',
            userColor: null, payload: {}, timestamp: new Date().toISOString(),
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
            session.breakpoints = session.breakpoints.filter(b => !(b.file === file && b.line === line));
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
          console.warn(`[WS UNKNOWN TYPE] type=${msg.type}`);
      }

    } catch (err) {
      console.error(`[WS HANDLER ERROR] type=${msg.type} | ${err.message}`);
      ws.send(JSON.stringify({
        type: 'ERROR', sessionId, userId: 'server', userName: 'server', userColor: null,
        payload: { message: err.message, originalType: msg.type },
        timestamp: new Date().toISOString(),
      }));
    }
  });

  // ── Disconnect ────────────────────────────────────────
  ws.on('close', () => {
    session.clients = session.clients.filter(c => c !== ws);
    session.users   = session.users.filter(u => u.userId !== userId);

    console.log(`[WS DISCONNECT] sessionId=${sessionId} userId=${userId} | remaining=${session.clients.length}`);

    if (session.clients.length > 0) {
      broadcastToSession(sessionId, {
        type: 'USER_LEFT', sessionId, userId, userName, userColor,
        payload: {}, timestamp: new Date().toISOString(),
      });
    }

    if (session.createdBy === userId && session.users.length > 0) {
      session.createdBy = session.users[0].userId;
      console.log(`[HOST TRANSFER] new host=${session.createdBy}`);
      broadcastToSession(sessionId, {
        type: 'HOST_CHANGED', sessionId, userId: 'server', userName: 'server', userColor: null,
        payload: { newHost: session.createdBy }, timestamp: new Date().toISOString(),
      });
    }

    if (session.clients.length === 0) {
      setTimeout(() => {
        const current = sessions.get(sessionId);
        if (current && current.clients.length === 0) {
          sessions.delete(sessionId);
          console.log(`[SESSION DELETED] sessionId=${sessionId}`);
        }
      }, 5000);
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS ERROR] sessionId=${sessionId} userId=${userId} | ${err.message}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));