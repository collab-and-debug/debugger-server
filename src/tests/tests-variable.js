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

  const extension = new WebSocket(`${BASE}&userId=ext&userName=Extension&userColor=%23a78bfa`);
  const dashboard = new WebSocket(`${BASE}&userId=dash&userName=Dashboard&userColor=%2334d399`);

  dashboard.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === 'VARIABLE_UPDATE') {
      console.log('[PASS] Dashboard received VARIABLE_UPDATE:');
      console.log(JSON.stringify(msg.payload.scopes, null, 2));
    }
    if (msg.type === 'SESSION_SNAPSHOT') {
      console.log('[PASS] Dashboard received SESSION_SNAPSHOT');
      console.log('  users:', msg.payload.users);
    }
  });

  extension.on('open', () => {
    setTimeout(() => {
      console.log('[Extension] sending variable-state...');
      extension.send(JSON.stringify({
        type:      'variable-state',
        sessionId,
        userId:    'ext',
        userName:  'Extension',
        userColor: '#a78bfa',
        payload:   {
          scopes: {
            local:  { x: 10, name: 'Aishwarya', isActive: true },
            global: { count: 3, appName: 'collab-debug' },
          }
        },
        timestamp: new Date().toISOString(),
      }));
    }, 500);
  });

  // Late joiner — connects after variables are stored
  // Should receive SESSION_SNAPSHOT with variables already in it
  setTimeout(() => {
    console.log('[Late joiner] connecting...');
    const late = new WebSocket(`${BASE}&userId=late&userName=LateUser&userColor=%23fb923c`);
    late.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.type === 'SESSION_SNAPSHOT') {
        console.log('[PASS] Late joiner got SESSION_SNAPSHOT with variables:');
        console.log(JSON.stringify(msg.payload.variables, null, 2));
        late.close();
      }
    });
  }, 1500);

  setTimeout(() => {
    extension.close();
    dashboard.close();
    console.log('Variables test done.');
    process.exit(0);
  }, 4000);
}

run();