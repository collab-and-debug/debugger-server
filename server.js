const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { createClient } = require('redis');

const app = express();
app.use(express.json());

// ─── Redis setup ─────────────────────────────────────────
// two clients needed - one cant both publish and subscribe at the same time
const publisher  = createClient({ url: process.env.REDIS_URL });
const subscriber = createClient({ url: process.env.REDIS_URL });

// local ws clients per session on THIS instance only
// redis handles cross-instance stuff, this handles local forwarding
const localClients = new Map(); // sessionId -> Set of ws

async function initRedis() {
  await publisher.connect();
  await subscriber.connect();
  console.log('redis connected');

  // listen for messages published by ANY instance and forward to local ws clients
  await subscriber.pSubscribe('session:*', (raw, channel) => {
    const sessionId = channel.replace('session:', '');
    const clients = localClients.get(sessionId);
    if (!clients) return;

    clients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) ws.send(raw);
    });
  });
}

initRedis().catch(err => {
  console.error('redis init failed:', err);
  process.exit(1); // no point running without redis in prod
});

// ─── Session helpers (redis instead of Map) ──────────────

const SESSION_TTL = 60 * 60 * 24; // 24 hours, sessions auto-cleanup

async function getSession(sessionId) {
  const data = await publisher.get(`sessiondata:${sessionId}`);
  return data ? JSON.parse(data) : null;
}

async function saveSession(sessionId, session) {
  // dont store ws refs in redis, only serialisable stuff
  const toStore = {
    createdBy:   session.createdBy,
    createdAt:   session.createdAt,
    breakpoints: session.breakpoints,
    variables:   session.variables,
    users:       session.users.map(u => ({
      userId: u.userId, userName: u.userName, userColor: u.userColor
      // intentionally dropping u.ws - cant serialise that
    })),
  };
  await publisher.set(`sessiondata:${sessionId}`, JSON.stringify(toStore), { EX: SESSION_TTL });
}

async function deleteSession(sessionId) {
  await publisher.del(`sessiondata:${sessionId}`);
}

// publish to redis so ALL instances get it and forward to their local ws clients
let messageSequence = 0;

async function broadcastToSession(sessionId, message, excludeWs = null) {
  messageSequence++;
  const payload = { ...message, seq: messageSequence };

  // if excludeWs is set, send to local clients directly (skip the excluded one)
  // then publish to redis for other instances
  const localSet = localClients.get(sessionId);
  if (localSet) {
    localSet.forEach(ws => {
      if (ws === excludeWs) return;
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    });
  }

  // other instances pick this up via pSubscribe above
  await publisher.publish(`session:${sessionId}`, JSON.stringify(payload));
}

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

// ─── HTTP + WebSocket server ──────────────────────────────
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

// ─── REST ROUTES ──────────────────────────────────────────

app.post('/session/create', async (req, res) => {
  try {
    const sessionId = uuidv4();
    const { userId } = req.body;

    const session = {
      createdBy:   userId || 'anonymous',
      createdAt:   Date.now(),
      breakpoints: [],
      variables:   {},
      users:       [],
    };

    await saveSession(sessionId, session);
    res.status(201).json({ sessionId });
  } catch (err) {
    console.error('create session error:', err);
    res.status(500).json({ error: 'failed to create session' });
  }
});

app.post('/session/join', async (req, res) => {
  try {
    const { sessionId, userId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const session = await getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    res.status(200).json({
      message:     'Joined successfully',
      sessionId,
      createdBy:   session.createdBy,
      createdAt:   session.createdAt,
      clientCount: session.users.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'failed to join session' });
  }
});

app.get('/session/:id', async (req, res) => {
  try {
    const session = await getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    res.json({
      sessionId:   req.params.id,
      createdBy:   session.createdBy,
      createdAt:   session.createdAt,
      userCount:   session.users.length,
      breakpoints: session.breakpoints,
    });
  } catch (err) {
    res.status(500).json({ error: 'failed to get session' });
  }
});

// ─── Heartbeat ────────────────────────────────────────────

function startHeartbeat(wss) {
  setInterval(() => {
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) { ws.terminate(); return; }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);
}

startHeartbeat(wss);

// ─── WebSocket ────────────────────────────────────────────

wss.on('connection', async (ws, req) => {
  const params    = new URLSearchParams(req.url.replace('/?', ''));
  const sessionId = params.get('sessionId');
  const userId    = params.get('userId');
  const userName  = params.get('userName');
  const userColor = decodeURIComponent(params.get('userColor') || '#888888');

  if (!sessionId) { ws.close(4000, 'sessionId is required'); return; }

  const session = await getSession(sessionId);
  if (!session) { ws.close(4004, 'Session not found'); return; }

  // track ws locally (cant go in redis)
  if (!localClients.has(sessionId)) localClients.set(sessionId, new Set());
  localClients.get(sessionId).add(ws);

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // handle reconnection - dont duplicate user in session
  const existingUser = session.users.find(u => u.userId === userId);
  if (!existingUser) {
    session.users.push({ userId, userName, userColor });
    await saveSession(sessionId, session);
  }

  // send snapshot to the new joiner only
  ws.send(JSON.stringify({
    type:      'SESSION_SNAPSHOT',
    seq:       ++messageSequence,
    sessionId,
    userId:    'server',
    userName:  'server',
    userColor: null,
    payload: {
      breakpoints:  session.breakpoints,
      variables:    session.variables,
      presentUsers: session.users,
    },
    timestamp: new Date().toISOString(),
  }));

  // tell everyone else someone joined
  await broadcastToSession(sessionId, {
    type: 'USER_JOINED', sessionId, userId, userName, userColor,
    payload: {}, timestamp: new Date().toISOString(),
  }, ws);

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      sendError(ws, sessionId, 'Invalid JSON');
      return;
    }

    if (!msg.timestamp) msg.timestamp = new Date().toISOString();

    // refetch session from redis on each message so we have latest state
    // across all instances
    const current = await getSession(sessionId);
    if (!current) { sendError(ws, sessionId, 'Session expired'); return; }

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
            const exists = current.breakpoints.some(b => b.file === file && b.line === line);
            if (!exists) {
              current.breakpoints.push({ file, line, userName: msg.userName, userColor: msg.userColor });
              await saveSession(sessionId, current);
            }
          }

          if (action === 'remove') {
            current.breakpoints = current.breakpoints.filter(
              b => !(b.file === file && b.line === line)
            );
            await saveSession(sessionId, current);
          }

          await broadcastToSession(sessionId, {
            type:      action === 'add' ? 'BREAKPOINT_HIT' : 'BREAKPOINT_REMOVED',
            sessionId, userId: msg.userId, userName: msg.userName, userColor: msg.userColor,
            payload:   { file, line },
            timestamp: msg.timestamp,
          }, ws);
          break;
        }

        case 'variable-state': {
          if (!msg.payload?.scopes) throw new Error('missing scopes');
          current.variables = msg.payload.scopes;
          await saveSession(sessionId, current);

          await broadcastToSession(sessionId, {
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

  ws.on('close', async () => {
    // remove from local tracking
    const set = localClients.get(sessionId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) localClients.delete(sessionId);
    }

    const current = await getSession(sessionId);
    if (!current) return;

    current.users = current.users.filter(u => u.userId !== userId);
    await saveSession(sessionId, current);

    if (current.users.length > 0) {
      await broadcastToSession(sessionId, {
        type: 'USER_LEFT', sessionId, userId, userName, userColor,
        payload: {}, timestamp: new Date().toISOString(),
      });

      // transfer host if the creator left
      if (current.createdBy === userId) {
        current.createdBy = current.users[0].userId;
        await saveSession(sessionId, current);
        await broadcastToSession(sessionId, {
          type: 'HOST_CHANGED', sessionId,
          userId: 'server', userName: 'server', userColor: null,
          payload: { newHost: current.createdBy },
          timestamp: new Date().toISOString(),
        });
      }
    } else {
      // nobody left in session, clean up after 5s in case of page refresh
      setTimeout(async () => {
        const check = await getSession(sessionId);
        if (check && check.users.length === 0) {
          await deleteSession(sessionId);
        }
      }, 5000);
    }
  });

  ws.on('error', (err) => {
    sendError(ws, sessionId, err.message);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`server running on port ${PORT}`));