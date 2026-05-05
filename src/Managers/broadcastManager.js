const { sessions } = require('./sessionManager');

function broadcastToSession(sessionId, message, excludeClient = null) {
  const session = sessions.get(sessionId);
  if (!session) return;

  const payload = JSON.stringify(message);

  for (const client of session.clients) {
    if (client === excludeClient) continue;
    if (client.readyState !== 1) continue;
    client.send(payload);
  }
}

module.exports = { broadcastToSession };