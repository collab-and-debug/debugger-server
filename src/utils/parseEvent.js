const { isValidEvent } = require('../Schemas/eventSchema');

function parseEvent(raw) {
  try {
    const msg = JSON.parse(raw);
    if (!isValidEvent(msg)) return null;
    if (!msg.timestamp) msg.timestamp = new Date().toISOString();
    return msg;
  } catch {
    return null;
  }
}

module.exports = { parseEvent };