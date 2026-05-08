const WebSocket = require('ws');
const http = require('http');

const SERVER_URL = 'ws://localhost:3000';
const HTTP_URL = 'http://localhost:3000';

const PING_COUNT = 200;
const PING_INTERVAL_MS = 50;

const latencies = [];
let sent = 0;
let received = 0;

function percentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.ceil((p / 100) * s.length) - 1];
}

// ✅ Create session automatically
function createSession() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${HTTP_URL}/session/create`,
      { method: 'POST' },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const json = JSON.parse(data);
          resolve(json.sessionId);
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function measureLatency() {
  console.log('LATENCY TEST');
  console.log('='.repeat(40));

  const sessionId = await createSession();
  console.log(`Session created: ${sessionId}`);

  console.log(`Sending ${PING_COUNT} messages, one per ${PING_INTERVAL_MS}ms`);
  console.log(`Target: avg < 100ms on localhost`);
  console.log('');

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`${SERVER_URL}?sessionId=${sessionId}&client=0`);

    ws.on('open', () => {
      console.log('Connected. Measuring...');

      const interval = setInterval(() => {
        if (sent >= PING_COUNT) {
          clearInterval(interval);
          setTimeout(() => {
            ws.close();
            resolve();
          }, 2000);
          return;
        }

        const msg = JSON.stringify({
          type: 'latency_ping',
          sentAt: Date.now(),
          seq: sent,
        });

        ws.send(msg);
        sent++;
      }, PING_INTERVAL_MS);
    });

    ws.on('message', (data) => {
      const receivedAt = Date.now();
      try {
        const msg = JSON.parse(data);

        if (msg.sentAt) {
          const latency = receivedAt - msg.sentAt;
          latencies.push(latency);
          received++;
        }
      } catch (_) {}
    });

    ws.on('close', resolve);
    ws.on('error', reject);
  });

  if (latencies.length === 0) {
    console.log('❌ No latency data received.');
    return;
  }

  const avg = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const min = Math.min(...latencies);
  const max = Math.max(...latencies);

  console.log('RESULTS');
  console.log('='.repeat(40));
  console.log(`Sent     : ${sent}`);
  console.log(`Received : ${received} (${((received / sent) * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`Min      : ${min}ms`);
  console.log(`Average  : ${avg}ms  ${avg < 100 ? '✅ under 100ms target' : '❌ over target'}`);
  console.log(`p50      : ${p50}ms`);
  console.log(`p95      : ${p95}ms`);
  console.log(`p99      : ${p99}ms`);
  console.log(`Max      : ${max}ms`);
  console.log('='.repeat(40));

  console.log('\nDistribution:');
  const buckets = [0, 10, 25, 50, 100, 200, 500];
  for (let i = 0; i < buckets.length - 1; i++) {
    const lo = buckets[i], hi = buckets[i + 1];
    const count = latencies.filter(l => l >= lo && l < hi).length;
    const pct = ((count / latencies.length) * 100).toFixed(0);
    const bar = '█'.repeat(Math.round(pct / 2));
    console.log(`  ${String(lo).padStart(3)}-${String(hi).padEnd(3)}ms : ${bar} ${pct}%`);
  }

  const over = latencies.filter(l => l >= 500).length;
  if (over > 0) {
    console.log(`  500ms+    : ${'█'.repeat(Math.round((over / latencies.length) * 50))} ${over}`);
  }
}

measureLatency().catch(err => {
  console.error('Error:', err.message);
  console.error('Is the server running? node server.js');
  process.exit(1);
});
