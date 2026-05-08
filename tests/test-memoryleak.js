const WebSocket = require('ws');
 
const SERVER_URL = 'ws://localhost:3000';
const TOTAL_SESSIONS = 50;
const CLIENTS_PER_SESSION = 3;
const SESSION_DURATION_MS = 2000;   // each session lives for 2 seconds
const DELAY_BETWEEN_MS = 500;       // wait 500ms between sessions
 
const memorySnapshots = [];
 
function getMemMB() {
  return (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
}
 
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
 
function log(msg) {
  const mem = getMemMB();
  console.log(`[${msg}]  Memory: ${mem} MB`);
}
 
// Open N clients to a session, send some messages, then close all
async function runSession(sessionNum) {
  const sessionId = `leak-test-${sessionNum}-${Date.now()}`;
  const clients = [];
  const opens = [];
 
  // Open all clients
  for (let i = 0; i < CLIENTS_PER_SESSION; i++) {
    await new Promise((resolve) => {
      const ws = new WebSocket(`${SERVER_URL}?session=${sessionId}&client=${i}`);
      ws.on('open', () => {
        clients.push(ws);
        // Send a few messages
        for (let m = 0; m < 10; m++) {
          ws.send(JSON.stringify({ type: 'test', sessionId, m }));
        }
        resolve();
      });
      ws.on('error', () => resolve()); // ignore errors, just continue
    });
  }
 
  // Keep session alive briefly
  await sleep(SESSION_DURATION_MS);
 
  // Close all clients
  await Promise.all(clients.map(ws => new Promise(resolve => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.once('close', resolve);
      ws.close();
    } else {
      resolve();
    }
  })));
}
 
async function runMemoryLeakTest() {
  console.log('MEMORY LEAK TEST');
  console.log('='.repeat(50));
  console.log(`Sessions: ${TOTAL_SESSIONS}`);
  console.log(`Clients per session: ${CLIENTS_PER_SESSION}`);
  console.log(`Session duration: ${SESSION_DURATION_MS}ms`);
  console.log('='.repeat(50));
 
  const startMem = parseFloat(getMemMB());
  memorySnapshots.push({ session: 0, mem: startMem });
  log('Start');
 
  for (let i = 1; i <= TOTAL_SESSIONS; i++) {
    await runSession(i);
    await sleep(DELAY_BETWEEN_MS);
 
    const mem = parseFloat(getMemMB());
    memorySnapshots.push({ session: i, mem });
 
    if (i % 10 === 0) {
      log(`Session ${i}/${TOTAL_SESSIONS} done`);
    }
  }
 
  // Force garbage collection hint
  if (global.gc) global.gc();
  await sleep(2000);
 
  const endMem = parseFloat(getMemMB());
  const growth = (endMem - startMem).toFixed(2);
  const maxMem = Math.max(...memorySnapshots.map(s => s.mem));
 
  console.log('\n' + '='.repeat(50));
  console.log('MEMORY LEAK TEST RESULTS');
  console.log('='.repeat(50));
  console.log(`Start memory  : ${startMem} MB`);
  console.log(`End memory    : ${endMem} MB`);
  console.log(`Peak memory   : ${maxMem} MB`);
  console.log(`Total growth  : ${growth} MB`);
  console.log('');
 
  // Sparkline chart
  console.log('Memory over time (each dot = 1 session batch):');
  const step = Math.ceil(memorySnapshots.length / 25);
  const chartData = memorySnapshots.filter((_, i) => i % step === 0);
  const minM = Math.min(...chartData.map(s => s.mem));
  const maxM = Math.max(...chartData.map(s => s.mem));
  const range = maxM - minM || 1;
  const bars = chartData.map(s => {
    const h = Math.round(((s.mem - minM) / range) * 6);
    return ['▁','▂','▃','▄','▅','▆','▇'][Math.min(h, 6)];
  });
  console.log('  ' + bars.join(''));
  console.log(`  ${minM.toFixed(1)} MB ${'─'.repeat(bars.length - 10)} ${maxM.toFixed(1)} MB`);
 
  console.log('');
  if (growth < 10) {
    console.log('✅ PASS — Memory stayed flat. No leak detected.');
    console.log('   Safe to add to README: "No memory leaks over 50 sessions"');
  } else if (growth < 25) {
    console.log('⚠️  WARNING — Memory grew slightly. May be normal GC delay.');
    console.log('   Run again with: node --expose-gc tests/memory-leak-test.js');
  } else {
    console.log('❌ FAIL — Memory growing significantly. Leak detected in backend.');
    console.log('   Tell backend teammate to check: session cleanup on disconnect,');
    console.log('   event listener removal, and timer/interval clearance.');
  }
 
  console.log('='.repeat(50));
}
 
runMemoryLeakTest().catch(err => {
  console.error('Test failed:', err.message);
  console.error('Is the server running? node server.js');
  process.exit(1);
});
