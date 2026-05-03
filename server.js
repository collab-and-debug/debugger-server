const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

// ─── In-memory session store ───────────────────────────
const sessions = new Map();

// ─── HTTP Server (shared with WebSocket) ───────────────
const server = http.createServer(app);

// ─── WebSocket Server ──────────────────────────────────
const wss = new WebSocket.Server({ server });

//  REST ROUTES

// POST /session/create
app.post('/session/create', (req, res) => {
  const sessionId = uuidv4();
  const { userId } = req.body;

  sessions.set(sessionId, {
    createdBy: userId || 'anonymous',
    createdAt: Date.now(),
    clients: []
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

//  WEBSOCKET

wss.on('connection', (ws, req) => {
  // Parse sessionId from URL → ws://localhost:3000?sessionId=abc-123
  const params = new URLSearchParams(req.url.replace('/?', ''));
  const sessionId = params.get('sessionId');

  // Validate sessionId provided
  if (!sessionId) {
    ws.close(4000, 'sessionId is required');
    console.log(`[WS REJECTED] No sessionId provided`);
    return;
  }

  // Validate session exists
  const session = sessions.get(sessionId);
  if (!session) {
    ws.close(4004, 'Session not found');
    console.log(`[WS REJECTED] sessionId=${sessionId} does not exist`);
    return;
  }

  // Add client to session
  session.clients.push(ws);
  console.log(`[WS CONNECT] sessionId=${sessionId} | clients=${session.clients.length}`);

  // Notify client they connected successfully
  ws.send(JSON.stringify({
    type: 'CONNECTION_ACK',
    message: 'Connected to session',
    sessionId,
    clientCount: session.clients.length
  }));

  // Handle incoming messages (placeholder for future features)
  ws.on('message', (data) => {
    console.log(`[WS MESSAGE] sessionId=${sessionId} | data=${data}`);

    // Broadcast to all OTHER clients in the same session
    session.clients.forEach(client => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  });

  // Handle disconnect
  ws.on('close', () => {
    session.clients = session.clients.filter(c => c !== ws);
    console.log(`[WS DISCONNECT] sessionId=${sessionId} | remaining=${session.clients.length}`);

    // Cleanup empty session
    if (session.clients.length === 0) {
      sessions.delete(sessionId);
      console.log(`[SESSION DELETED] sessionId=${sessionId} — no clients left`);
    }
  });

  // Handle WS errors
  ws.on('error', (err) => {
    console.error(`[WS ERROR] sessionId=${sessionId} | error=${err.message}`);
  });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});