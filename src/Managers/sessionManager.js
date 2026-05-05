const { createSessionShape } = require('../Schemas/sessionSchema');
const { v4: uuidv4 }         = require('uuid');

const sessions = new Map();

function createSession() {
  const sessionId = uuidv4();
  sessions.set(sessionId, createSessionShape());
  return sessionId;
}

function getSession(sessionId) {
  return sessions.get(sessionId);
}

function sessionExists(sessionId) {
  return sessions.has(sessionId);
}

module.exports = { sessions, createSession, getSession, sessionExists };