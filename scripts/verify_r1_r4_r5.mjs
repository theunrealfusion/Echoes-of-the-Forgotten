// scripts/verify_r1_r4_r5.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ico': 'image/x-icon',
};

// 1. Create static HTTP server
function createServer(port) {
  const server = http.createServer((req, res) => {
    try {
      let reqPath = decodeURI(req.url.split('?')[0]);
      if (reqPath === '/') {
        reqPath = '/index.html';
      }
      const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
      const filePath = path.join(ROOT_DIR, safePath);

      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`404 Not Found: ${reqPath}`);
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`500 Internal Server Error: ${err.message}`);
    }
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

// 2. CDP Client
class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.eventListeners = new Map();

    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
    });

    this.ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.id && this.callbacks.has(data.id)) {
        const { resolve, reject } = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) {
          reject(new Error(data.error.message || JSON.stringify(data.error)));
        } else {
          resolve(data.result);
        }
      } else if (data.method) {
        const listeners = this.eventListeners.get(data.method) || [];
        for (const fn of listeners) {
          fn(data.params);
        }
      }
    };
  }

  send(method, params = {}) {
    const id = this.id++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.eventListeners.has(method)) {
      this.eventListeners.set(method, []);
    }
    this.eventListeners.get(method).push(fn);
  }

  close() {
    try { this.ws.close(); } catch (_) {}
  }
}

async function run() {
  const CDP_PORT = 9333;

  console.log('[1] Starting HTTP server on random free port...');
  const server = await createServer(0);
  const HTTP_PORT = server.address().port;
  console.log(`    HTTP server listening on http://127.0.0.1:${HTTP_PORT}`);

  console.log(`[2] Launching Chromium on CDP port ${CDP_PORT}...`);
  const chromeProc = spawn('/usr/bin/chromium-browser', [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--window-size=1280,720',
    'about:blank',
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  chromeProc.stderr.on('data', (d) => {
    // console.log(`[chrome-stderr] ${d.toString().trim()}`);
  });

  // Wait for CDP Page target to be ready
  let wsUrl = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      if (res.ok) {
        const pages = await res.json();
        const page = pages.find((p) => p.type === 'page');
        if (page && page.webSocketDebuggerUrl) {
          wsUrl = page.webSocketDebuggerUrl;
          break;
        }
      }
    } catch (_) {}
  }

  if (!wsUrl) {
    chromeProc.kill();
    server.close();
    throw new Error('Failed to connect to Chromium CDP port');
  }

  console.log(`[3] Connected to CDP: ${wsUrl}`);
  const client = new CDPClient(wsUrl);
  await client.ready;

  // Track console and network
  const consoleErrors = [];
  const consoleWarnings = [];
  const consoleLogs = [];
  const failedRequests = [];
  const allRequests = [];

  client.on('Log.entryAdded', (params) => {
    if (params.entry.level === 'error') {
      consoleErrors.push(params.entry);
    } else if (params.entry.level === 'warning') {
      consoleWarnings.push(params.entry);
    }
  });

  client.on('Runtime.consoleAPICalled', (params) => {
    const text = params.args.map((a) => a.value || a.description || '').join(' ');
    if (params.type === 'error') {
      consoleErrors.push({ text, type: params.type, args: params.args });
    } else if (params.type === 'warning') {
      consoleWarnings.push({ text, type: params.type, args: params.args });
    } else {
      consoleLogs.push({ text, type: params.type });
    }
  });

  client.on('Runtime.exceptionThrown', (params) => {
    consoleErrors.push({
      text: params.exceptionDetails.text || params.exceptionDetails.exception?.description,
      exception: params.exceptionDetails,
    });
  });

  client.on('Network.responseReceived', (params) => {
    const { url, status, statusText } = params.response;
    allRequests.push({ url, status });
    if (status >= 400) {
      failedRequests.push({ url, status, statusText });
    }
  });

  client.on('Network.loadingFailed', (params) => {
    failedRequests.push({ requestId: params.requestId, errorText: params.errorText });
  });

  // Enable domains
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Log.enable');
  await client.send('Network.enable');

  console.log(`[4] Navigating to http://127.0.0.1:${HTTP_PORT}/game/index.html...`);
  await client.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/game/index.html` });

  // Wait for game initialization
  console.log('[5] Waiting for game initialization and loading screen dismissal...');
  let gameInitialized = false;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const evalRes = await client.send('Runtime.evaluate', {
      expression: `Boolean(window.__game && window.__game.isRunning && window.__game.world)`,
      returnByValue: true,
    });
    if (evalRes.result && evalRes.result.value === true) {
      gameInitialized = true;
      console.log(`    Game initialized at ~${(i + 1) * 0.5}s!`);
      break;
    }
  }

  // Let render loop run a bit
  await new Promise((r) => setTimeout(r, 1500));

  const results = {};

  // 1. Check Console Errors and 404s at Cold Load
  console.log('[Step 1] Checking cold load console errors and network requests...');
  results.coldLoadErrors = [...consoleErrors];
  results.coldLoadWarnings = [...consoleWarnings];
  results.failedRequests = [...failedRequests];
  results.totalRequests = allRequests.length;
  console.log(`   Cold load console errors: ${results.coldLoadErrors.length}`);
  console.log(`   Cold load 404 / failed requests: ${results.failedRequests.length}`);

  // 2. Inspect window.__game.world.zoneObjects
  console.log('[Step 2] Evaluating window.__game.world.zoneObjects...');
  const zoneInfoRes = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const g = window.__game;
      if (!g || !g.world || !g.world.zoneObjects) return { ok: false, error: 'No world or zoneObjects' };
      const zo = g.world.zoneObjects;
      const keys = Array.from(zo.keys());
      const details = {};
      for (const k of keys) {
        const list = zo.get(k) || [];
        details[k] = {
          count: list.length,
          type: list.map(o => o.type || o.constructor.name)
        };
      }
      return {
        ok: true,
        isMap: zo instanceof Map,
        keys: keys,
        details: details
      };
    })()`,
    returnByValue: true,
  });
  results.zoneObjects = zoneInfoRes.result?.value;
  console.log('   Zone objects found:', results.zoneObjects);

  // 3. Inspect AudioContext
  console.log('[Step 3] Inspecting AudioContext initialization...');
  const audioInfoRes = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const g = window.__game;
      if (!g || !g.audio) return { ok: false, error: 'No audio system' };
      const ctx = g.audio.ctx;
      return {
        ok: true,
        hasCtx: Boolean(ctx),
        stateBeforeUnlock: ctx ? ctx.state : null,
        startedFlag: g.audio._started,
        hasVoidAmbient: g.audio._ambientGains.void !== null,
        hasRestoredAmbient: g.audio._ambientGains.restored !== null
      };
    })()`,
    returnByValue: true,
  });
  results.audioInitial = audioInfoRes.result?.value;
  console.log('   Audio initial state:', results.audioInitial);

  // Test AudioContext Unlock via keydown gesture
  console.log('[Step 3b] Testing AudioContext unlock via keydown gesture (WASD)...');
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'KeyW',
    code: 'KeyW',
    windowsVirtualKeyCode: 87,
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'KeyW',
    code: 'KeyW',
    windowsVirtualKeyCode: 87,
  });
  await new Promise((r) => setTimeout(r, 400));

  const audioKeyUnlockRes = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const g = window.__game;
      return {
        ok: true,
        stateAfterKeyUnlock: g && g.audio && g.audio.ctx ? g.audio.ctx.state : null
      };
    })()`,
    returnByValue: true,
  });
  results.audioKeyUnlock = audioKeyUnlockRes.result?.value;
  console.log('   Audio state after key gesture:', results.audioKeyUnlock);

  // Record errors before canvas click
  results.errorsBeforeCanvasClick = [...consoleErrors];

  // Test Canvas Click (which invokes PointerLockControls.lock())
  console.log('[Step 3c] Simulating canvas click (desktop PointerLock + Audio unlock)...');
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 200,
    y: 200,
    button: 'left',
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 200,
    y: 200,
    button: 'left',
    clickCount: 1,
  });
  await new Promise((r) => setTimeout(r, 600));

  results.errorsAfterCanvasClick = [...consoleErrors];
  console.log(`   Errors introduced by canvas click: ${results.errorsAfterCanvasClick.length - results.errorsBeforeCanvasClick.length}`);

  // 4. Inspect VR Button and WebXR
  console.log('[Step 4] Checking VRButton and WebXR settings...');
  const vrInfoRes = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const btn = document.getElementById('VRButton');
      const g = window.__game;
      return {
        vrButtonExists: Boolean(btn),
        vrButtonId: btn ? btn.id : null,
        vrButtonText: btn ? btn.textContent : null,
        vrButtonTag: btn ? btn.tagName : null,
        xrEnabled: g && g.renderer ? Boolean(g.renderer.xr.enabled) : false,
        animationLoopActive: g ? Boolean(g.isRunning) : false
      };
    })()`,
    returnByValue: true,
  });
  results.webxr = vrInfoRes.result?.value;
  console.log('   WebXR details:', results.webxr);

  // 5. Mobile Joystick & Multi-touch Isolation Test
  console.log('[Step 5] Testing Mobile Joystick touch identifier handling...');
  const mobileTestRes = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const g = window.__game;
      const p = g ? g.player : null;
      if (!p) return { ok: false, error: 'No player controller' };

      const joystickEl = document.getElementById('virtual-joystick');
      if (!joystickEl) return { ok: false, error: 'No virtual joystick element' };

      // Ensure mobile listeners are active
      p.enable();

      // Test 1: Start touch 101 on joystick
      const startTouch = { identifier: 101, clientX: 100, clientY: 100 };
      const startEvt = new CustomEvent('touchstart', { cancelable: true });
      startEvt.changedTouches = [startTouch];
      startEvt.touches = [startTouch];
      joystickEl.dispatchEvent(startEvt);

      const stateAfterStart = {
        active: p._joystickActive,
        joyTouchId: p._joyTouchId,
        delta: { ...p._joystickDelta }
      };

      // Test 2: Move touch 999 (foreign touch / multi-touch finger)
      const foreignTouch = { identifier: 999, clientX: 500, clientY: 500 };
      const foreignMoveEvt = new CustomEvent('touchmove', { cancelable: true });
      foreignMoveEvt.changedTouches = [foreignTouch];
      foreignMoveEvt.touches = [startTouch, foreignTouch];
      joystickEl.dispatchEvent(foreignMoveEvt);

      const stateAfterForeignMove = {
        active: p._joystickActive,
        joyTouchId: p._joyTouchId,
        delta: { ...p._joystickDelta }
      };

      // Test 3: Move touch 101 (primary joystick touch)
      const primaryMoveTouch = { identifier: 101, clientX: 130, clientY: 100 };
      const primaryMoveEvt = new CustomEvent('touchmove', { cancelable: true });
      primaryMoveEvt.changedTouches = [primaryMoveTouch];
      primaryMoveEvt.touches = [primaryMoveTouch, foreignTouch];
      joystickEl.dispatchEvent(primaryMoveEvt);

      const stateAfterPrimaryMove = {
        active: p._joystickActive,
        joyTouchId: p._joyTouchId,
        delta: { ...p._joystickDelta }
      };

      // Test 4: End foreign touch 999
      const foreignEndEvt = new CustomEvent('touchend', { cancelable: true });
      foreignEndEvt.changedTouches = [foreignTouch];
      foreignEndEvt.touches = [primaryMoveTouch];
      joystickEl.dispatchEvent(foreignEndEvt);

      const stateAfterForeignEnd = {
        active: p._joystickActive,
        joyTouchId: p._joyTouchId,
        delta: { ...p._joystickDelta }
      };

      // Test 5: End primary touch 101
      const primaryEndEvt = new CustomEvent('touchend', { cancelable: true });
      primaryEndEvt.changedTouches = [primaryMoveTouch];
      primaryEndEvt.touches = [];
      joystickEl.dispatchEvent(primaryEndEvt);

      const stateAfterPrimaryEnd = {
        active: p._joystickActive,
        joyTouchId: p._joyTouchId,
        delta: { ...p._joystickDelta }
      };

      return {
        ok: true,
        stateAfterStart,
        stateAfterForeignMove,
        stateAfterPrimaryMove,
        stateAfterForeignEnd,
        stateAfterPrimaryEnd,
        foreignMoveIgnored: (
          stateAfterForeignMove.joyTouchId === 101 &&
          stateAfterForeignMove.delta.x === 0 &&
          stateAfterForeignMove.delta.y === 0
        ),
        primaryMoveRegistered: (
          stateAfterPrimaryMove.joyTouchId === 101 &&
          stateAfterPrimaryMove.delta.x > 0.5
        ),
        foreignEndIgnored: (
          stateAfterForeignEnd.active === true &&
          stateAfterForeignEnd.joyTouchId === 101
        ),
        primaryEndResets: (
          stateAfterPrimaryEnd.active === false &&
          stateAfterPrimaryEnd.joyTouchId === null &&
          stateAfterPrimaryEnd.delta.x === 0
        )
      };
    })()`,
    returnByValue: true,
  });
  results.mobileJoystickTest = mobileTestRes.result?.value;

  // 6. R4 Performance Test with 4x CPU Throttling
  console.log('[6] Running 4x CPU Throttling performance benchmark...');
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const fpsBenchmarkRes = await client.send('Runtime.evaluate', {
    expression: `(async () => {
      const g = window.__game;
      // 1. Measure raw engine tick time over 200 iterations
      const tickTimes = [];
      for (let i = 0; i < 200; i++) {
        const t0 = performance.now();
        g.update(0.016);
        const t1 = performance.now();
        tickTimes.push(t1 - t0);
      }
      const avgTickMs = tickTimes.reduce((a, b) => a + b, 0) / tickTimes.length;
      const sortedTicks = [...tickTimes].sort((a, b) => a - b);
      const p95TickMs = sortedTicks[Math.floor(sortedTicks.length * 0.95)];

      // 2. Measure requestAnimationFrame frame deltas
      const frameTimes = [];
      let lastTime = performance.now();
      const SAMPLE_COUNT = 120;

      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          const sum = frameTimes.reduce((a, b) => a + b, 0);
          const avgDelta = frameTimes.length > 0 ? sum / frameTimes.length : 16.6;
          resolve({
            timeout: true,
            samples: frameTimes.length,
            avgDeltaMs: avgDelta,
            avgFps: 1000 / avgDelta,
            avgTickMs,
            p95TickMs
          });
        }, 6000);

        function sample(now) {
          const delta = now - lastTime;
          lastTime = now;
          if (delta > 0 && delta < 500) {
            frameTimes.push(delta);
          }
          if (frameTimes.length >= SAMPLE_COUNT) {
            clearTimeout(timer);
            const sum = frameTimes.reduce((a, b) => a + b, 0);
            const avgDelta = sum / frameTimes.length;
            const avgFps = 1000 / avgDelta;
            const sorted = [...frameTimes].sort((a, b) => a - b);
            const p99Delta = sorted[Math.floor(sorted.length * 0.99)];
            const minFps = 1000 / p99Delta;

            resolve({
              timeout: false,
              samples: frameTimes.length,
              avgDeltaMs: avgDelta,
              avgFps: avgFps,
              minFps: minFps,
              p99DeltaMs: p99Delta,
              avgTickMs,
              p95TickMs
            });
          } else {
            requestAnimationFrame(sample);
          }
        }
        requestAnimationFrame(sample);
      });
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  results.fpsBenchmark = fpsBenchmarkRes.result?.value;

  // Reset throttling
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });

  // 7. Test Root URL Redirect and Landing Page
  console.log(`[7] Testing root redirect http://127.0.0.1:${HTTP_PORT}/index.html...`);
  const rootNavRes = await client.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/index.html` });
  await new Promise((r) => setTimeout(r, 1200));

  const currentUrlRes = await client.send('Runtime.evaluate', {
    expression: `window.location.href`,
    returnByValue: true,
  });
  results.rootRedirectTarget = currentUrlRes.result?.value;

  // Cleanup
  client.close();
  chromeProc.kill();
  server.close();

  console.log('\n=== EMPIRICAL VERIFICATION RESULTS ===\n');
  console.log(JSON.stringify(results, null, 2));

  return results;
}

run().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
