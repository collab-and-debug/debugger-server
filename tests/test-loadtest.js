
 
const WebSocket = require('ws');
const os = require('os');
 
// ─── CONFIG ────────────────────────────────────────────────────────────────
const SERVER_URL = 'ws://localhost:3000'; // Change if your server runs on a different port
const TOTAL_SESSIONS = 5;          // 5 separate rooms
const CLIENTS_PER_SESSION = 3;     // 3 people per room
const MESSAGES_PER_SECOND = 20;    // each client sends 20 msg/s
const TEST_DURATION_MS = 30000;    // run for 30 seconds
const MESSAGE_INTERVAL_MS = Math.floor(1000 / MESSAGES_PER_SECOND); // = 50ms
 
// ─── TRACKING ──────────────────────────────────────────────────────────────
let totalSent = 0;
let totalReceived = 0;
let latencies = [];             // stores every round-trip time in ms
let errors = 0;
let activeClients = 0;
 
// ─── HELPERS ───────────────────────────────────────────────────────────────
function getMemoryMB() {
  // How much RAM is the Node process using right now?
  return (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
}
 
function getCPUPercent() {
  // Rough CPU load average (1 minute)
  const load = os.loadavg()[0];
  const cpus = os.cpus().length;
  return ((load / cpus) * 100).toFixed(1);
}
 
function calculatePercentile(arr, p) {
  // p95 means: 95% of messages arrived faster than this number
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)].toFixed(2);
}
 
function log(msg) {
  const time = new Date().toISOString().substr(11, 8);
  console.log(`[${time}] ${msg}`);
}
 
// ─── SINGLE CLIENT ─────────────────────────────────────────────────────────
function createClient(sessionId, clientId) {
  return new Promise((resolve) => {
    let ws;
    let intervalId;
    let resolved = false;
 
    try {
      // Connect to the server with session info in query string
      ws = new WebSocket(`${SERVER_URL}?session=${sessionId}&client=${clientId}`);
    } catch (e) {
      errors++;
      resolve();
      return;
    }
 
    ws.on('open', () => {
      activeClients++;
 
      // Send messages on a fixed interval
      intervalId = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
 
        const payload = JSON.stringify({
          type: 'test_message',
          sessionId,
          clientId,
          sentAt: Date.now(),       // timestamp so we can measure latency
          payload: 'x'.repeat(100), // 100 byte payload — realistic message size
        });
 
        try {
          ws.send(payload);
          totalSent++;
        } catch (e) {
          errors++;
        }
      }, MESSAGE_INTERVAL_MS);
    });
 
    ws.on('message', (data) => {
      totalReceived++;
      try {
        const msg = JSON.parse(data);
        // If server echoes back our sentAt, measure round-trip latency
        if (msg.sentAt) {
          const latency = Date.now() - msg.sentAt;
          latencies.push(latency);
        }
      } catch (_) {
        // Server might send non-JSON — that's fine, still count it received
      }
    });
 
    ws.on('error', () => {
      errors++;
    });
 
    ws.on('close', () => {
      activeClients = Math.max(0, activeClients - 1);
      if (intervalId) clearInterval(intervalId);
      if (!resolved) {
        resolved = true;
        resolve(ws);
      }
    });
 
    // Stop this client when the test ends
    setTimeout(() => {
      if (intervalId) clearInterval(intervalId);
      if (ws.readyState === WebSocket.OPEN) ws.close();
      if (!resolved) {
        resolved = true;
        resolve(ws);
      }
    }, TEST_DURATION_MS);
  });
}
 
// ─── MEMORY MONITOR ────────────────────────────────────────────────────────
const memoryLog = [];
function startMemoryMonitor() {
  const id = setInterval(() => {
    memoryLog.push({
      time: Date.now(),
      memMB: parseFloat(getMemoryMB()),
      cpu: parseFloat(getCPUPercent()),
    });
  }, 5000); // sample every 5 seconds
  return id;
}
 
// ─── REPORT ────────────────────────────────────────────────────────────────
function printReport() {
  console.log('\n');
  console.log('═'.repeat(60));
  console.log('  LOAD TEST RESULTS');
  console.log('═'.repeat(60));
 
  console.log('\n📊 MESSAGE STATS');
  console.log(`   Total sent     : ${totalSent}`);
  console.log(`   Total received : ${totalReceived}`);
  const lossRate = totalSent > 0
    ? (((totalSent - totalReceived) / totalSent) * 100).toFixed(1)
    : 0;
  console.log(`   Message loss   : ${lossRate}%  ${lossRate < 1 ? '✅' : '❌ (target: <1%)'}`);
  console.log(`   Errors         : ${errors}`);
 
  console.log('\n⚡ LATENCY (round-trip, milliseconds)');
  if (latencies.length > 0) {
    const avg = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2);
    const p50 = calculatePercentile(latencies, 50);
    const p95 = calculatePercentile(latencies, 95);
    const p99 = calculatePercentile(latencies, 99);
    const max = Math.max(...latencies).toFixed(2);
 
    console.log(`   Average  : ${avg}ms  ${avg < 100 ? '✅' : '❌ (target: <100ms)'}`);
    console.log(`   p50      : ${p50}ms`);
    console.log(`   p95      : ${p95}ms  ${p95 < 200 ? '✅' : '❌ (target: <200ms)'}`);
    console.log(`   p99      : ${p99}ms`);
    console.log(`   Max      : ${max}ms`);
    console.log(`   Samples  : ${latencies.length}`);
  } else {
    console.log('   No latency data — server may not be echoing sentAt field');
    console.log('   Ask backend teammate to echo sentAt back in WebSocket messages');
  }
 
  console.log('\n💾 MEMORY OVER TIME (client process)');
  if (memoryLog.length > 0) {
    const first = memoryLog[0].memMB;
    const last = memoryLog[memoryLog.length - 1].memMB;
    const max = Math.max(...memoryLog.map(m => m.memMB));
    const growth = (last - first).toFixed(2);
    console.log(`   Start  : ${first} MB`);
    console.log(`   End    : ${last} MB`);
    console.log(`   Peak   : ${max} MB`);
    console.log(`   Growth : ${growth} MB  ${growth < 10 ? '✅ stable' : '⚠️  possible leak'}`);
    console.log('\n   Timeline:');
    memoryLog.forEach((m, i) => {
      const bar = '█'.repeat(Math.min(30, Math.round(m.memMB / 2)));
      console.log(`   ${String(i * 5).padStart(3)}s  ${String(m.memMB).padStart(6)} MB  ${bar}`);
    });
  }
 
  console.log('\n🎯 VERDICT');
  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 999;
  const memGrowth = memoryLog.length > 1
    ? memoryLog[memoryLog.length - 1].memMB - memoryLog[0].memMB
    : 0;
 
  if (avgLatency < 100 && memGrowth < 10 && lossRate < 1) {
    console.log('   ✅ PASS — Server handles load within targets');
  } else {
    if (avgLatency >= 100) console.log('   ❌ Latency too high — backend needs optimization');
    if (memGrowth >= 10) console.log('   ❌ Memory growing — possible leak in backend');
    if (lossRate >= 1) console.log('   ❌ Message loss too high — check WebSocket handler');
  }
 
  console.log('\n📝 Copy these numbers into README Performance section:');
  console.log(`   Sessions: ${TOTAL_SESSIONS} concurrent`);
  console.log(`   Clients : ${TOTAL_SESSIONS * CLIENTS_PER_SESSION} total`);
  console.log(`   Msg rate: ${MESSAGES_PER_SECOND} msg/s per client`);
  if (latencies.length > 0) {
    const avg = (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(0);
    const p95 = calculatePercentile(latencies, 95);
    console.log(`   Avg latency: ${avg}ms | p95: ${p95}ms`);
  }
  console.log('═'.repeat(60));
}
 
// ─── MAIN ──────────────────────────────────────────────────────────────────
async function runLoadTest() {
  log(`Starting load test`);
  log(`Config: ${TOTAL_SESSIONS} sessions × ${CLIENTS_PER_SESSION} clients × ${MESSAGES_PER_SECOND} msg/s`);
  log(`Duration: ${TEST_DURATION_MS / 1000} seconds`);
  log(`Connecting to: ${SERVER_URL}`);
  log('─'.repeat(50));
 
  const memMonitor = startMemoryMonitor();
 
  // Create all clients across all sessions
  const allClients = [];
  for (let s = 0; s < TOTAL_SESSIONS; s++) {
    const sessionId = `load-test-session-${s}`;
    for (let c = 0; c < CLIENTS_PER_SESSION; c++) {
      allClients.push(createClient(sessionId, c));
    }
  }
 
  log(`Created ${allClients.length} clients across ${TOTAL_SESSIONS} sessions`);
 
  // Print live stats every 5 seconds
  const statsInterval = setInterval(() => {
    log(`Live: sent=${totalSent} recv=${totalReceived} active=${activeClients} mem=${getMemoryMB()}MB`);
  }, 5000);
 
  // Wait for all clients to finish
  await Promise.all(allClients);
 
  clearInterval(statsInterval);
  clearInterval(memMonitor);
 
  // Wait one more second for any final messages
  await new Promise(r => setTimeout(r, 1000));
 
  printReport();
  process.exit(0);
}
 
runLoadTest().catch(err => {
  console.error('Load test failed:', err.message);
  console.error('Is your server running? Try: node server.js');
  process.exit(1);
});
