// Runs in the workbench renderer. No VS Code internals, AMD, or Node access.
const key = '__apcModernImports';
if (!globalThis[key]) {
  const root = new URL('.', import.meta.url);
  let allowed = new Set();
  const policy = globalThis.trustedTypes?.createPolicy('apcImports', {
    createScriptURL(value) {
      if (!allowed.has(value)) { throw new Error('APC rejected an unconfigured script URL'); }
      return value;
    },
  });
  const nodes = new Set();
  const executed = new Set();
  let revision;
  let pending = false;
  let disposed = false;
  let unavailable = false;

  function clear() {
    nodes.forEach(node => node.remove());
    nodes.clear();
  }

  async function apply(config) {
    if (config.revision === revision) { return; }
    clear();
    revision = config.revision;
    allowed = new Set(config.entries.filter(entry => entry.kind === 'js').map(entry => new URL(entry.src, root).href));
    for (const entry of config.entries) {
      try {
        if (entry.kind === 'css') {
          const node = document.createElement(entry.src ? 'link' : 'style');
          for (const [name, value] of Object.entries(entry.attributes || {})) { node.setAttribute(name, value); }
          if (entry.src) { node.rel = 'stylesheet'; node.href = entry.src; }
          else { node.textContent = entry.text; }
          document.head.appendChild(node);
          nodes.add(node);
        } else {
          const url = new URL(entry.src, root).href;
          // CSS edits/config refreshes must not re-evaluate unchanged scripts.
          // Arbitrary JS side effects need a window reload to be undone.
          if (executed.has(url)) { continue; }
          const node = document.createElement('script');
          for (const [name, value] of Object.entries(entry.attributes || {})) { node.setAttribute(name, value); }
          node.async = false;
          node.src = policy ? policy.createScriptURL(url) : url;
          let executionError;
          const onError = event => { if (event.filename === url) { executionError = event.error || new Error(event.message); } };
          addEventListener('error', onError);
          try {
            await new Promise((resolve, reject) => {
              node.onload = () => executionError ? reject(executionError) : resolve();
              node.onerror = () => reject(new Error(`Cannot load APC script: ${entry.source || url}`));
              nodes.add(node);
              document.head.appendChild(node);
            });
          } finally { removeEventListener('error', onError); }
          executed.add(url);
        }
      } catch (error) { console.error('APC import failed:', entry.source || entry.src || 'stylesheet', error); }
    }
    document.documentElement.dataset.apcImportsRevision = revision;
  }

  async function refresh() {
    if (pending || disposed || !document.querySelector('.monaco-workbench')) { return; }
    pending = true;
    try {
      const response = await fetch(new URL(`config.json?time=${Date.now()}`, root));
      if (!response.ok) { throw new Error(`APC config: ${response.status}`); }
      await apply(await response.json());
      unavailable = false;
    } catch (error) {
      if (revision !== undefined) { clear(); revision = undefined; }
      if (!unavailable) { console.error('APC imports unavailable; reload the window after disabling APC:', error); unavailable = true; }
    } finally { pending = false; }
  }

  const timer = setInterval(refresh, 1000);
  globalThis[key] = {
    dispose() { disposed = true; clearInterval(timer); clear(); delete globalThis[key]; },
  };
  addEventListener('pagehide', () => globalThis[key]?.dispose(), { once: true });
  void refresh();
}
