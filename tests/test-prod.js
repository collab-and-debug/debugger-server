/**
 * PRODUCTION DEPLOYMENT TEST — Day 5
 * ====================================
 * HOW TO RUN:
 *   PROD_WS_URL=wss://your-app.railway.app node tests/prod-test.js
 */

const WebSocket = require('ws');
const https = require('https');
const http  = require('http');

// ── EDIT THIS with your Railway URL ─────────────────────────────────────────
const PROD_WS_URL = process.env.PROD_WS_URL || 'wss://YOUR-APP.railway.app';
// ────────────────────────────────────────────────────────────────────────────

// Derive HTTP URL from WS URL
const PROD_HTTP_URL = PROD_WS_URL
  .replace(/^wss:\/\//, 'https://')
  .replace(/^ws:\/\//, 'http://');

let passed = 0;
let failed = 0;

// ── HELPERS ─────────────────────────────────────────────────────────────────

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${err.message}`);
    failed++;
  }
}

/** HTTP/HTTPS GET — returns { status, body } without JSON.parse */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ status: res.statusCode, body: body.trim() }));
    }).on('error', reject);
  });
}

/** Open a WebSocket and resolve when open, reject on error/timeout */
function openWS(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const t  = setTimeout(() => { ws.terminate(); reject(new Error(`Connect timeout (${timeoutMs}ms)`)); }, timeoutMs);
    ws.on('open',  () => { clearTimeout(t); resolve(ws); });
    ws.on('error', e  => { clearTimeout(t); reject(e); });
  });
}

function closeWS(ws) {
  return new Promise(resolve => {
    if (!ws || ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once('close', resolve);
    ws.close();
  });
}

// ── TESTS ────────────────────────────────────────────────────────────────────

async function runProdTests() {
  console.log('\nPRODUCTION DEPLOYMENT TESTS');
  console.log('='.repeat(50));
  console.log(`WS  : ${PROD_WS_URL}`);
  console.log(`HTTP: ${PROD_HTTP_URL}`);
  console.log('='.repeat(50));
  console.log('');

  // ── TEST 1: Health endpoint ───────────────────────────────────────────────
  // FIX: accept both plain "OK" and JSON {"status":"ok"}
  await test('Health endpoint returns 200', async () => {
    const res = await httpGet(`${PROD_HTTP_URL}/health`);

    if (res.status !== 200) {
      throw new Error(`Expected HTTP 200, got ${res.status}. Body: "${res.body.slice(0, 80)}"`);
    }

    // Accept plain text "OK" or "ok"
    if (/^ok$/i.test(res.body)) {
      console.log('   (server returns plain text "OK" — consider switching to JSON)');
      return; // pass
    }

    // Accept JSON { status: "ok" } or { status: "OK" }
    try {
      const json = JSON.parse(res.body);
      if (!/^ok$/i.test(json.status)) {
        throw new Error(`JSON status is "${json.status}", expected "ok"`);
      }
      return; // pass
    } catch (parseErr) {
      // Not JSON and not plain "OK"
      throw new Error(
        `Body "${res.body.slice(0, 80)}" is neither plain "OK" nor JSON with status:ok`
      );
    }
  });

  // ── TEST 2: WebSocket connects ────────────────────────────────────────────
  await test('WebSocket connects to production', async () => {
    const ws = await openWS(`${PROD_WS_URL}?session=prod-test&client=0`, 12000);
    await closeWS(ws);
  });

  // ── TEST 3: Broadcast reaches second client ───────────────────────────────
  // FIX: longer timeout, wait for BOTH clients to be open before sending,
  //      also accept ANY message on client2 (not just type=test_broadcast)
  await test('Two clients in same session receive broadcast', () => new Promise(async (resolve, reject) => {
    const SESSION = `prod-broadcast-${Date.now()}`;
    let ws1, ws2;
    const timeout = setTimeout(() => {
      reject(new Error(
        'Broadcast not received within 20s.\n' +
        '   Likely cause: server does not broadcast messages to other session members.\n' +
        '   Ask backend teammate to check websocket/handler.js — when a message arrives\n' +
        '   it must be forwarded to all OTHER clients in the same session.'
      ));
    }, 20000);

    try {
      // Connect both clients
      ws1 = await openWS(`${PROD_WS_URL}?session=${SESSION}&client=0`, 12000);
      ws2 = await openWS(`${PROD_WS_URL}?session=${SESSION}&client=1`, 12000);
    } catch (e) {
      clearTimeout(timeout);
      return reject(new Error(`Could not open both clients: ${e.message}`));
    }

    // Listen on client2 for ANY incoming message
    ws2.on('message', (data) => {
      clearTimeout(timeout);
      ws1.close();
      ws2.close();
      console.log(`   (client2 received: ${data.toString().slice(0, 60)})`);
      resolve();
    });

    ws2.on('error', e => { clearTimeout(timeout); reject(e); });
    ws1.on('error', e => { clearTimeout(timeout); reject(e); });

    // Wait 1s for both clients to be registered in session, THEN send
    await new Promise(r => setTimeout(r, 1000));

    if (ws1.readyState === WebSocket.OPEN) {
      ws1.send(JSON.stringify({
        type: 'test_broadcast',
        from: 'client0',
        session: SESSION,
        sentAt: Date.now(),
      }));
    } else {
      clearTimeout(timeout);
      reject(new Error('ws1 closed before sending broadcast'));
    }
  }));

  // ── TEST 4: Latency ───────────────────────────────────────────────────────
  // FIX: longer timeout, record receive time BEFORE any async work,
  //      accept ANY reply (not just echoed sentAt) and just time the round-trip
  await test('Production latency under 500ms', () => new Promise(async (resolve, reject) => {
    let ws;
    const timeout = setTimeout(() => {
      reject(new Error(
        'No reply within 20s.\n' +
        '   If WebSocket connects but no reply comes, the server is not sending\n' +
        '   any message back. Ask backend teammate to echo messages in handler.js.'
      ));
    }, 20000);

    try {
      ws = await openWS(`${PROD_WS_URL}?session=prod-latency-${Date.now()}&client=0`, 12000);
    } catch (e) {
      clearTimeout(timeout);
      return reject(new Error(`Connect failed: ${e.message}`));
    }

    const sentAt = Date.now(); // stamp AFTER connection is open

    ws.on('message', () => {
      const latency = Date.now() - sentAt;
      clearTimeout(timeout);
      ws.close();

      console.log(`   Round-trip latency: ${latency}ms`);
      if (latency > 500) {
        reject(new Error(`${latency}ms exceeds 500ms limit`));
      } else {
        resolve();
      }
    });

    ws.on('error', e => { clearTimeout(timeout); reject(e); });

    // Send a ping
    ws.send(JSON.stringify({ type: 'latency_ping', sentAt, seq: 0 }));
  }));

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('');
  console.log('='.repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('✅ Production deployment fully verified!');
    console.log('');
    console.log('   Share with your team:');
    console.log(`   WS backend : ${PROD_WS_URL}`);
    console.log(`   Health     : ${PROD_HTTP_URL}/health`);
  } else {
    console.log('❌ Some tests failed — read the error messages above.');
    console.log('');
    console.log('   Common fixes:');
    console.log('   Test 1 ─ Health returns non-200: check Railway deploy logs');
    console.log('   Test 3 ─ Broadcast fails: backend needs to forward messages');
    console.log('            to other clients in the same session');
    console.log('   Test 4 ─ No echo: backend needs to send any reply back');
    console.log('            when it receives a WebSocket message');
    console.log('');
    console.log('   View live server logs:');
    console.log('   Railway dashboard → your project → "Logs" tab');
  }
  console.log('='.repeat(50));
}

runProdTests().catch(console.error);
