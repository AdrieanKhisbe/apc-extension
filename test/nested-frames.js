const assert = require('node:assert/strict');
const vscode = require('vscode');
const { eventually } = require('./cdp');

exports.run = async function (expected) {
  const panel = vscode.window.createWebviewPanel('apc-nested-frames', 'APC nested frames', vscode.ViewColumn.One, { enableScripts: true });
  const messages = [];
  const listener = panel.webview.onDidReceiveMessage(value => messages.push(value));
  const scriptData = value => JSON.stringify(value).replace(/</g, '\\u003c');
  function html(generation) {
    const nonce = `nested-${generation}`;
    function child(kind) {
      const descendant = kind === 'opaque' ? `const nested=document.createElement('iframe');nested.sandbox='allow-scripts';nested.srcdoc=${scriptData(child('grandchild'))};document.body.appendChild(nested);addEventListener('message',event=>{if(event.source===nested.contentWindow)parent.postMessage(event.data,'*');});` : '';
      return `<!doctype html><html><body>${kind}<script>globalThis.apcUnauthorized=true;</script><script nonce="${nonce}">
        setInterval(()=>{let parentReadable=false,topReadable=false;try{void parent.document.body;parentReadable=true;}catch{}try{void top.document.body;topReadable=true;}catch{}
        parent.postMessage({kind:${scriptData(kind)},generation:${scriptData(generation)},marker:getComputedStyle(document.body).getPropertyValue('--apc-webview-test').trim(),parentReadable,topReadable,unauthorized:!!globalThis.apcUnauthorized},'*');},100);${descendant}
      </script></body></html>`;
    }
    return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'none'; frame-src 'self';"></head><body>APC parent webview<script nonce="${nonce}">
      const api=acquireVsCodeApi();const frames=[];
      for(const [kind,sandbox,srcdoc] of ${scriptData([['same-origin', 'allow-scripts allow-same-origin', child('same-origin')], ['opaque', 'allow-scripts', child('opaque')]])}){
        const frame=document.createElement('iframe');frame.sandbox=sandbox;frame.srcdoc=srcdoc;frames.push(frame);document.body.appendChild(frame);
      }
      addEventListener('message',event=>{if(frames.some(frame=>frame.contentWindow===event.source))api.postMessage({...event.data,messageOrigin:event.origin});});
      setInterval(()=>{let topReadable=false;try{void top.document.body;topReadable=true;}catch{}api.postMessage({kind:'parent',generation:${scriptData(generation)},marker:getComputedStyle(document.body).getPropertyValue('--apc-webview-test').trim(),topReadable});},100);
    </script></body></html>`;
  }
  async function inspect(generation) {
    return eventually(() => {
      const latest = Object.fromEntries(messages.filter(value => value.generation === generation).map(value => [value.kind, value]));
      if (!['parent', 'same-origin', 'opaque', 'grandchild'].every(kind => latest[kind])) { return false; }
      assert.equal(latest.parent.marker, expected, 'APC CSS must reach the hosting webview');
      assert.equal(latest.parent.topReadable, false, 'The parent webview must remain isolated from the workbench');
      for (const kind of ['same-origin', 'opaque', 'grandchild']) {
        assert.equal(latest[kind].marker, '', 'APC CSS must not be recursively injected into embedded documents');
        assert.equal(latest[kind].topReadable, false, `${kind} must not access the workbench DOM`);
        assert.equal(latest[kind].unauthorized, false, `${kind} must retain the inherited script CSP`);
        assert.equal(latest[kind].parentReadable, kind === 'same-origin', 'Frame sandbox permissions must remain unchanged');
      }
      assert.equal(latest.opaque.messageOrigin, 'null', 'A sandboxed frame must retain its opaque origin');
      assert.equal(latest.grandchild.messageOrigin, 'null', 'Forwarded sandboxed descendant messages must stay isolated');
      return latest;
    }, `Nested ${generation} frames did not preserve style/CSP boundaries: ${JSON.stringify(messages.slice(-4))}`);
  }
  try {
    panel.webview.html = html('initial');
    const initial = await inspect('initial');
    panel.webview.html = html('recreated');
    const recreated = await inspect('recreated');
    console.log('PASS: same-origin, sandboxed and two-level frames retain CSS boundaries, inherited CSP and workbench isolation after recreation.');
    return { initial, recreated };
  } finally { listener.dispose(); panel.dispose(); }
};
