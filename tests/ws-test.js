// // ws-test.js
// This script pretends to be 2 users connecting to our server

const WebSocket = require('ws');
const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3000';

// Helper: wait for a message on a WebSocket
function waitForMessage(ws) {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data));
    });
  });
}

// Helper: log test result
function logResult(testName, expected, actual, passed) {
  console.log(`\n--- TEST: ${testName} ---`);
  console.log(`Expected: ${expected}`);
  console.log(`Actual:   ${actual}`);
  console.log(`Result:   ${passed ? '✅ PASS' : '❌ FAIL'}`);
  return { testName, expected, actual, passed };
}

async function runTests() {
  const results = [];

  // ── TEST 1: Create a Session ──────────────────────────────
  let sessionId;
  try {
    const res = await fetch(`${BASE_URL}/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hostName: 'Alice' })
    });
    const data = await res.json();
    sessionId = data.sessionId;
    const passed = res.status === 200 && !!sessionId;
    results.push(logResult(
      'Create Session',
      'Status 200 + sessionId returned',
      `Status ${res.status}, sessionId: ${sessionId}`,
      passed
    ));
  } catch (e) {
    results.push(logResult('Create Session', 'Status 200', `ERROR: ${e.message}`, false));
    process.exit(1);
  }

  // ── TEST 2: Connect Client 1 (Alice) ─────────────────────
  const client1 = new WebSocket(`ws://localhost:3000?sessionId=${sessionId}&user=Alice`);
  await new Promise(r => client1.on('open', r));
  results.push(logResult(
    'Client 1 Connect',
    'WebSocket opens successfully',
    'Connected',
    true
  ));

  // ── TEST 3: Connect Client 2 (Bob) ───────────────────────
  const client2 = new WebSocket(`ws://localhost:3000?sessionId=${sessionId}&user=Bob`);
  await new Promise(r => client2.on('open', r));
  results.push(logResult(
    'Client 2 Connect',
    'WebSocket opens successfully',
    'Connected',
    true
  ));

  // ── TEST 4: Broadcast Message ─────────────────────────────
  // Both clients listen for the message
  const msg1Promise = waitForMessage(client1);
  const msg2Promise = waitForMessage(client2);

  // Client 1 sends a message
  client1.send(JSON.stringify({ type: 'breakpoint', line: 42, file: 'app.js' }));

  const [msg1, msg2] = await Promise.all([msg1Promise, msg2Promise]);

  results.push(logResult(
    'Client 1 Receives Broadcast',
    'line: 42',
    `line: ${msg1.line}`,
    msg1.line === 42
  ));

  results.push(logResult(
    'Client 2 Receives Broadcast',
    'line: 42',
    `line: ${msg2.line}`,
    msg2.line === 42
  ));

  // ── TEST 5: Invalid Session Join ──────────────────────────
  const res404 = await fetch(`${BASE_URL}/session/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'FAKE-999', userName: 'Eve' })
  });
  results.push(logResult(
    'Join Invalid Session',
    'Status 404',
    `Status ${res404.status}`,
    res404.status === 404
  ));

  // Cleanup
  client1.close();
  client2.close();

  // ── Print Summary ─────────────────────────────────────────
  console.log('\n========== SUMMARY ==========');
  const passed = results.filter(r => r.passed).length;
  console.log(`${passed}/${results.length} tests passed`);

  return results;
}

runTests().catch(console.error);
