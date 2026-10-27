const assert = require('node:assert/strict');

async function eventually(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError;
  do {
    try {
      const result = await check();
      if (result) { return result; }
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 150));
  } while (Date.now() < deadline);
  throw new Error(`${message}${lastError ? `: ${lastError.message}` : ''}`);
}

async function connect(port) {
  const target = await eventually(async () => {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return targets.find(item => item.type === 'page' && item.url.includes('workbench.html'));
  }, 'Workbench debugging target did not start');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    const callback = pending.get(response.id);
    if (callback) {
      pending.delete(response.id);
      callback(response);
    }
  });
  return {
    async evaluate(expression) {
      const requestId = ++id;
      const response = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('CDP timed out')); }, 10000);
        pending.set(requestId, value => { clearTimeout(timer); resolve(value); });
        socket.send(JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
      });
      assert.ok(!response.error && !response.result.exceptionDetails, JSON.stringify(response));
      return response.result.result.value;
    },
    close: () => socket.close(),
  };
}

module.exports = { connect, eventually };
