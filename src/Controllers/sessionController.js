const { createSession, sessionExists } = require('../Managers/sessionManager');

function handleCreate(req, res) {
  const sessionId = createSession();
  res.json({ sessionId });
}

function handleJoin(req, res) {
  const { sessionId } = req.body;
  if (!sessionExists(sessionId)) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json({ sessionId });
}

module.exports = { handleCreate, handleJoin };