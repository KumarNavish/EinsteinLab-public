// Existing keyless test host only. Exact production client carrier, no provider.
import {RenewableSocket} from '../rehearsal/src/renewable-socket.js';
const local = process.argv.includes('--local');
const origin = local ? 'http://127.0.0.1:8795' : 'https://einstein-hosting-probe.fastapicloud.dev';
const plan = {scope: 'One logical keyless conversation across two planned browser carrier renewals', providerRequests: 0,
  target: origin, requiredSeconds: 600, hardSeconds: 630, maximumLogicalStarts: 1, expectedRenewals: 2};
if (!process.argv.includes('--run')) { console.log(JSON.stringify(plan)); process.exit(0); }
const response = await fetch(origin), status = await response.json();
if (!response.ok || status.probe !== 'einstein-renewable-websocket-duration' || status.provider_requests !== 0 || status.active) throw Error('Keyless target contract differs.');
const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
if (!cookie?.startsWith('einstein_connection_probe=')) throw Error('Keyless visitor cookie missing.');
const report = {state: 'RUNNING_UNVERIFIED', plan, startedAt: new Date().toISOString(), samples: [], frames: 0};
const began = performance.now();
class OwnedSocket extends WebSocket {
  constructor(address) { super(address, {headers: {Cookie: cookie, Origin: origin}}); }
}
const address = new URL('/ws', origin); address.protocol = local ? 'ws:' : 'wss:';
const socket = new RenewableSocket(address, {Socket: OwnedSocket});
let timer, heartbeat;
await new Promise(resolve => {
  timer = setTimeout(() => { report.failure = 'hard_deadline'; socket.close(); resolve(); }, plan.hardSeconds * 1000);
  heartbeat = setInterval(() => { if (socket.readyState === 1) socket.send('tick'); }, 10000);
  socket.onrenew = count => { report.renewals = count; };
  socket.onmessage = event => {
    let value; try { value = JSON.parse(event.data); } catch { report.failure = 'invalid_frame'; socket.close(); return; }
    const seconds = value.elapsed_seconds;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0 || seconds > 605) { report.failure = 'invalid_elapsed'; socket.close(); return; }
    report.frames++; report.lastServerSeconds = seconds;
    if (!report.samples.length || seconds - report.samples.at(-1).serverSeconds >= 30) report.samples.push({serverSeconds: seconds, clientMs: Math.round(performance.now() - began)});
  };
  socket.onerror = () => { report.transportError = true; };
  socket.onclose = event => { report.close = {code: event.code, wasClean: event.wasClean, elapsedMs: Math.round(performance.now() - began)}; resolve(); };
});
clearTimeout(timer); clearInterval(heartbeat);
let final;
for (let attempt = 0; attempt < 12; attempt++) {
  final = await (await fetch(origin, {headers: {Cookie: cookie}})).json();
  if (!final.active && final.last) break;
  await new Promise(resolve => setTimeout(resolve, 250));
}
report.final = {active: final.active, starts: final.starts, providerRequests: final.provider_requests, last: final.last};
report.completedAt = new Date().toISOString();
report.state = !report.failure && !report.transportError && report.renewals === 2 && final.starts === 1 && final.active === false
  && final.provider_requests === 0 && final.last?.outcome === 'deadline' && final.last.elapsed_seconds >= 600
  && final.last.elapsed_seconds < 606 && final.last.renewals === 2 && final.last.peak_buffer_bytes <= 1048576
  && report.close?.code === 1000 && report.close.wasClean ? 'KEYLESS_RENEWABLE_CONVERSATION_PASSED' : 'FAILED_OR_INCOMPLETE';
console.log('EINSTEIN_CONNECTION_PROBE ' + JSON.stringify(report));
if (report.state !== 'KEYLESS_RENEWABLE_CONVERSATION_PASSED') process.exitCode = 1;
