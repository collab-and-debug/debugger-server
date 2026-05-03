// server.js
const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

const sessions = new Map();

// ─── CREATE ───────────────────────────────────────────
// Who calls this? The user who wants to START a room
app.post('/session/create', (req, res) => {
  const sessionId = uuidv4();
  const { userId } = req.body; // who is creating it

  sessions.set(sessionId, {
    createdBy: userId,
    createdAt: Date.now(),
    clients: [userId]       // creator auto-joins
  });

  res.status(201).json({ sessionId });
});

// ─── JOIN ─────────────────────────────────────────────
// Who calls this? Anyone who received a sessionId and wants in
app.post('/session/join', (req, res) => {
  const { sessionId, userId } = req.body;

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  if (session.clients.includes(userId)) {
    return res.status(400).json({ error: 'Already in session' });
  }

  session.clients.push(userId);
  res.json({ message: 'Joined', clients: session.clients });
});

// ─── GET INFO ─────────────────────────────────────────
// Who calls this? Anyone wanting to see who's in a room
app.get('/session/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  res.json(session);
});

// ─── LEAVE ────────────────────────────────────────────
app.post('/session/leave', (req, res) => {
  const { sessionId, userId } = req.body;

  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  session.clients = session.clients.filter(c => c !== userId);

  // Auto-cleanup if room is empty
  if (session.clients.length === 0) {
    sessions.delete(sessionId);
    return res.json({ message: 'Session closed (empty)' });
  }

  res.json({ message: 'Left session', clients: session.clients });
});

app.listen(3000, () => console.log('Server on port 3000'));