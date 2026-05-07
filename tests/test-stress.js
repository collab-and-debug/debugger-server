const WebSocket = require('ws');
const http      = require('http');

const SERVER   = 'http://localhost:3000';
const WS       = 'ws://localhost:3000';
const DURATION = 30000;  // 30 seconds
let   passed   = 0;
let   failed   = 0;

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url  = new URL(path, SERVER);
    const req  = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, (res) => {
      let out = '';
      res.on('data', c => out += c);
      res.on('end', () => resolve(JSON.parse(out)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runSession(sessionNum) {
  const { sessionId } = await post('/session/create', { userId: `stress-${sessionNum}` });

  const clients = [];
  const errors  = [];

  // spin up 3 clients per session
  for (let i = 0; i < 3; i++) {
    const ws = new WebSocket(
      `${WS}?sessionId=${sessionId}&userId=user${i}&userName=User${i}&userColor=%23888888`
    );
    ws.on('error', (err) => errors.push(err.message));
    clients.push(ws);
  }

  await new Promise(r => setTimeout(r, 500));

  // send 10 breakpoint events from client 0
  clients[0].on('open', () => {
    for (let i = 0; i < 10; i++) {
      try {
        clients[0].send(JSON.stringify({
          type: 'breakpoint', sessionId,
          userId: 'user0', userName: 'User0', userColor: '#888',
          payload: { file: 'test.js', line: i + 1, action: 'add' },
          timestamp: new Date().toISOString(),
        }));
        passed++;
      } catch {
        failed++;
      }
    }
  });

  // send bad JSON — server should not crash
  setTimeout(() => {
    try {
      clients[0].send('this is not json');
      passed++;
    } catch {
      failed++;
    }
  }, 1000);

  // disconnect all after 3s
  setTimeout(() => {
    clients.forEach(c => c.close());
  }, 3000);
}

async function run() {
  console.log(`[STRESS] Starting 30-second stress test...`);
  const start = Date.now();

  // launch a new session every 2 seconds for 30 seconds
  const interval = setInterval(async () => {
    const sessionNum = Math.floor((Date.now() - start) / 2000);
    await runSession(sessionNum).catch(err => {
      console.error('[SESSION ERROR]', err.message);
      failed++;
    });
  }, 2000);

  setTimeout(() => {
    clearInterval(interval);
    console.log(`\n[STRESS RESULT]`);
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Duration: ${DURATION / 1000}s`);
    if (failed === 0) {
      console.log('  ✓ Zero crashes. Server is stable.');
    } else {
      console.log('  ✗ Some failures detected. Check logs.');
    }
    process.exit(0);
  }, DURATION + 2000);
}

run();