import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

// Playwright attaches to page targets and disables Chromium prerendering.
// A single native CDP connection allows this test to exercise real activation.
export async function prerenderBrowser() {
  const profile = await mkdtemp(join(tmpdir(), 'joblink-prerender-'));
  const process = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1530,1000', 'about:blank'], { windowsHide: true });
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Browser did not expose CDP')), 15000);
    process.once('error', reject);
    process.stderr.on('data', chunk => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const task = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) task?.reject(Error(message.error.message)); else task?.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    else if (message.method === 'Preload.prerenderStatusUpdated') console.log('Preparation:', message.params.status, message.params.prerenderStatus || '', message.params.disallowedMojoInterface || '');
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`CDP timeout: ${method}`)); }, 8000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetInfos } = await send('Target.getTargets', { filter: [{ type: 'tab' }] });
  const tab = targetInfos.find(target => target.url === 'about:blank') || targetInfos[0];
  const { sessionId: tabSession } = await send('Target.attachToTarget', { targetId: tab.targetId, flatten: true });
  let sessionId;
  const pageSessions = new Map();
  const attached = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Browser did not attach the page target')), 8000);
    const previous = socket.onmessage;
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      previous(event);
      if (message.method === 'Target.attachedToTarget' && message.params.targetInfo.type === 'page') {
        pageSessions.set(message.params.targetInfo.targetId, message.params.sessionId);
        void send('Runtime.enable', {}, message.params.sessionId).catch(() => {});
      }
      if (message.method === 'Target.targetInfoChanged' && message.params.targetInfo.type === 'page' && !message.params.targetInfo.subtype) {
        const active = pageSessions.get(message.params.targetInfo.targetId);
        if (active) sessionId = active;
      }
      if (message.method === 'Target.attachedToTarget' && message.params.targetInfo.type === 'page' && message.params.targetInfo.subtype !== 'prerender') {
        clearTimeout(timer);
        sessionId = message.params.sessionId;
        resolve(message.params.sessionId);
      }
    };
  });
  await send('Target.setDiscoverTargets', { discover: true });
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, tabSession);
  await attached;
  const command = (method, params) => send(method, params, sessionId);
  await command('Page.setPrerenderingAllowed', { isAllowed: true });
  await command('Runtime.enable');
  await command('Preload.enable');
  const evaluate = async (expression, targetSession = sessionId) => {
    let result;
    try { result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, targetSession); }
    catch (error) {
      // Activation replaces the old page target with the prepared one.
      if (/Session with given id not found|Execution context was destroyed/.test(error.message)) return undefined;
      throw error;
    }
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const pointer = async (selector, click = false) => {
    const point = await evaluate(`(() => { const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2} })()`);
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    if (click) {
      await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    }
  };
  return { evaluate, pointer, errors, allow: () => command('Page.setPrerenderingAllowed', { isAllowed: true }), navigate: url => command('Page.navigate', { url }), async close() {
    await Promise.race([send('Browser.close').catch(() => {}), new Promise(resolve => setTimeout(resolve, 1000))]);
    socket.close();
    if (process.exitCode === null) await new Promise(resolve => { process.once('exit', resolve); setTimeout(resolve, 3000); });
    if (process.exitCode === null) process.kill();
    // Delete only the unique profile created by this fixture inside temp.
    if (resolve(profile).startsWith(resolve(tmpdir()) + sep) && profile.includes('joblink-prerender-')) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } };
}
