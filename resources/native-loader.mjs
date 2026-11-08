// Evaluated before VS Code's mainImpl module. Its configuration is a snapshot
// serialized by the extension host; no profile/settings IO occurs at startup.
import electron from 'electron';

const options = /*__APC_NATIVE_OPTIONS__*/{};
globalThis[Symbol.for('apc.native.options')] = original => ({
  ...original,
  ...options,
  webPreferences: original.webPreferences,
});

// VS Code reapplies theme colors and traffic-light offsets after construction.
// Keep explicit user choices on every window without changing other setters.
electron.app.on('browser-window-created', (_event, window) => {
  if (options.backgroundColor !== undefined) {
    const original = window.setBackgroundColor.bind(window);
    window.setBackgroundColor = () => original(options.backgroundColor);
    window.setBackgroundColor(options.backgroundColor);
  }
  if (options.trafficLightPosition !== undefined && typeof window.setWindowButtonPosition === 'function') {
    const original = window.setWindowButtonPosition.bind(window);
    window.setWindowButtonPosition = () => original(options.trafficLightPosition);
    window.setWindowButtonPosition(options.trafficLightPosition);
  }
});
