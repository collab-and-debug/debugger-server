const WebSocket = require('ws');
const http      = require('http');

function post(path, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req  = http.request({
      hostname: 'localhost', port: 3000, path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => resolve(JSON.parse(out)));
    });
    req.write(data);
    req.end();
  });
}

async function run() {
  const { sessionId } = await post('/session/create', { userId: 'tester' });
  console.log('Created session:', sessionId);

  const BASE = `ws://localhost:3000?sessionId=${sessionId}`;

  const clientA = new WebSocket(`${BASE}&userId=userA&userName=UserA&userColor=%23f87171`);
  const clientB = new WebSocket(`${BASE}&userId=userB&userName=UserB&userColor=%2360a5fa`);

  clientB.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === 'BREAKPOINT_HIT') {
      console.log('[PASS] Client B received BREAKPOINT_HIT:', msg.payload);
    }
    if (msg.type === 'BREAKPOINT_REMOVED') {
      console.log('[PASS] Client B received BREAKPOINT_REMOVED:', msg.payload);
    }
  });

  clientA.on('open', () => {
    setTimeout(() => {
      console.log('[Client A] sending breakpoint add...');
      clientA.send(JSON.stringify({
        type:      'breakpoint',
        sessionId,
        userId:    'userA',
        userName:  'UserA',
        userColor: '#f87171',
        payload:   { file: 'index.js', line: 42, action: 'add' },
        timestamp: new Date().toISOString(),
      }));
    }, 500);

    setTimeout(() => {
      console.log('[Client A] sending breakpoint remove...');
      clientA.send(JSON.stringify({
        type:      'breakpoint',
        sessionId,
        userId:    'userA',
        userName:  'UserA',
        userColor: '#f87171',
        payload:   { file: 'index.js', line: 42, action: 'remove' },
        timestamp: new Date().toISOString(),
      }));
    }, 1500);
  });

  setTimeout(() => {
    clientA.close();
    clientB.close();
    console.log('Breakpoint test done.');
    process.exit(0);
  }, 3000);
}

run();