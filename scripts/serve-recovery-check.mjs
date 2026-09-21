// Local-only fault relay for a manually operated browser acceptance check.
// Serves the unchanged app, forwards to development only, and drops one genuine
// successful task-create confirmation. It never invents a server response.
// Use an interactive terminal for stdin commands, or send SIGUSR2 to the printed
// PID to release the fault. --resume starts a replacement relay without a fault.
import http from 'node:http';
import https from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { isAppRoute } from '../web/routes.js';

const upstream = 'https://befitting-cobra-234.convex.cloud';
const port = 4181, origin = `http://127.0.0.1:${port}`;
const root = resolve('web');
const targetTitle = 'Synthetic browser lost confirmation';
const armed = !process.argv.includes('--resume');
const sockets = new Set();
const report = { targetTitle, dropped: false, released: false, transmissions: 0 };
let held = false, stopping = false;
const emit = event => console.log(JSON.stringify(event));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.png':'image/png', '.webp':'image/webp', '.json':'application/json' };
const server = http.createServer(async (req, res) => {
  // No public bind, arbitrary upstream, cookies, request logging or control API.
  if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) { res.writeHead(403).end(); return; }
  const pathname = new URL(req.url, origin).pathname;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (pathname.startsWith('/api/')) {
    const headers = {};
    for (const name of ['content-type','authorization','convex-client']) if (req.headers[name]) headers[name] = req.headers[name];
    const request = https.request(upstream + req.url, { method:req.method, headers }, response => {
      res.writeHead(response.statusCode, { 'Content-Type':response.headers['content-type'] || 'application/json' });
      response.pipe(res);
    });
    request.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(request); return;
  }
  try {
    if (pathname === '/config.js') {
      res.writeHead(200, { 'Content-Type':mime['.js'] });
      res.end(`window.HANDOFF_CONFIG=${JSON.stringify({convexUrl:origin})};\n`); return;
    }
    const file = resolve(root, '.' + (pathname === '/' || isAppRoute(pathname) ? '/index.html' : decodeURIComponent(pathname)));
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw Error('not found');
    res.writeHead(200, { 'Content-Type':mime[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
});
const wss = new WebSocketServer({ noServer:true });
server.on('upgrade', (req, socket, head) => {
  if (held || req.headers.origin !== origin || !/^\/api\/[^/]+\/sync$/.test(req.url)) {
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return;
  }
  wss.handleUpgrade(req, socket, head, downstream => {
    const remote = new WebSocket(upstream.replace('https:', 'wss:') + req.url);
    sockets.add(downstream); sockets.add(remote);
    const queue = [];
    let blocked = false, matchedRequest;
    downstream.on('message', (bytes, binary) => {
      if (blocked) return;
      if (!binary) {
        const message = JSON.parse(bytes.toString());
        if (message.type === 'Mutation' && message.udfPath === 'tasks:create' && message.args?.[0]?.title === targetTitle) {
          matchedRequest = message.requestId;
          report.transmissions++;
          emit({ phase:'target-mutation-forwarded', requestId:matchedRequest, transmissions:report.transmissions });
        }
      }
      if (remote.readyState === WebSocket.OPEN) remote.send(bytes, {binary});
      else queue.push([bytes,binary]);
    });
    remote.on('open', () => { for (const [bytes,binary] of queue) remote.send(bytes,{binary}); queue.length=0; });
    remote.on('message', (bytes, binary) => {
      if (blocked) return;
      const message = !binary && JSON.parse(bytes.toString());
      if (armed && !report.dropped && message?.type === 'MutationResponse' && message.requestId === matchedRequest && message.success) {
        report.dropped=true; report.taskId=message.result; held=true; blocked=true;
        emit({ phase:'committed-confirmation-dropped', ...report });
        downstream.close(1012,'Synthetic connection loss'); remote.close(); return;
      }
      if (downstream.readyState === WebSocket.OPEN) downstream.send(bytes,{binary});
    });
    downstream.on('close', () => { sockets.delete(downstream); remote.close(); });
    remote.on('close', () => { sockets.delete(remote); downstream.close(); });
    downstream.on('error', () => remote.close());
    remote.on('error', () => downstream.close());
  });
});
// Recovery is controlled from this process's stdin, never from browser script.
process.stdin.setEncoding('utf8');
function release() { held=false; report.released=true; emit({phase:'connection-released',...report}); }
process.stdin.on('data', data => {
  if (data.trim() === 'release') release();
  if (data.trim() === 'status') emit({phase:'status',held,...report});
  if (data.trim() === 'stop') stop();
});
function stop() {
  if (stopping) return; stopping=true;
  for (const socket of sockets) socket.terminate();
  wss.close(); server.close(() => process.exit(0));
  setTimeout(() => process.exit(0),1000).unref();
}
process.on('SIGINT',stop); process.on('SIGTERM',stop);
process.on('SIGUSR2',release);
server.listen(port,'127.0.0.1',()=>emit({phase:'ready',origin,upstream,targetTitle,armed,pid:process.pid}));
