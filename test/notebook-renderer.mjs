// Browser-side fixture loaded by VS Code's actual notebook renderer service.
export const activate = context => ({
  renderOutputItem(_item, element) {
    element.textContent = 'APC notebook renderer fixture';
    context.postMessage({
      kind: 'notebook-output',
      marker: getComputedStyle(element).getPropertyValue('--apc-webview-test').trim(),
    });
  },
});
