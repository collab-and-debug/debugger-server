// validates an incoming WS event has required fields
function isValidEvent(msg) {
  return msg.type && msg.sessionId && msg.userId && msg.userName;
}

module.exports = { isValidEvent };