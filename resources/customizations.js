// Loaded before the workbench bundle; the same singleton receives live settings.
(() => {
  if (globalThis.__apcCustomizations) { return; }
  let config = {};
  const lists = new Set();
  const layouts = new Set();
  const tabsControls = new Set();
  const tabStyles = new Map();
  let horizontalStyle;
  let creatingActivity = false;
  const defaults = ['customview-tree', 'results', 'open-editors', 'explorer-folders-view', 'outline-tree', 'scm-view', 'debug-view-content', 'debug-breakpoints', 'tree'];
  const positive = (value, fallback) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
  function rowSettings(container) {
    const settings = config.listRow || {};
    const names = new Set([...(settings.lists || (settings.height || settings.fontSize ? defaults : [])), ...Object.keys(settings.parts || {})]);
    for (const name of names) {
      if (/^[a-z][a-z0-9-]*$/.test(name) && container.closest(`.${name}`)) { return { ...settings, ...settings.parts?.[name] }; }
    }
  }
  function styleTabs(tabs) {
    const settings = config.header || {};
    const value = tabs.groupsView.partOptions.tabHeight === 'compact' ? settings.compact ?? settings.height : settings.default ?? settings.height;
    for (const node of tabs.parent.querySelectorAll('.tabs-container,.tabs-and-actions-container,.tab')) {
      if (value !== undefined) {
        if (!tabStyles.has(node)) { tabStyles.set(node, [node.style.getPropertyValue('height'), node.style.getPropertyPriority('height'), node.style.getPropertyValue('box-sizing'), node.style.getPropertyPriority('box-sizing')]); }
        node.style.setProperty('height', `${positive(value, 35)}px`, 'important');
        node.style.setProperty('box-sizing', 'border-box', 'important');
      } else if (tabStyles.has(node)) {
        const previous = tabStyles.get(node);
        node.style.setProperty('height', previous[0], previous[1]);
        node.style.setProperty('box-sizing', previous[2], previous[3]);
        tabStyles.delete(node);
      }
    }
  }
  function applyLayout(state) {
    const { owner, grid, status, activity, originalStatusLocation } = state;
    activity.updateCompactStyle?.();
    status._onDidChange?.fire(undefined);
    activity._onDidChange?.fire(undefined);
    for (const [part, original] of state.titles) {
      if (part.titleArea) { part.titleArea.style.height = config['sidebar.titlebar']?.height ? `${positive(config['sidebar.titlebar'].height, original)}px` : original; }
    }
    const position = config.statusBar?.position || 'bottom';
    const underPanel = position === 'editor-bottom' && owner.isVisible('workbench.parts.panel') && owner.panelPartView.getContainer()?.classList.contains('bottom');
    const placement = `${position}:${underPanel ? 'panel' : 'editor'}:${owner.getPanelAlignment?.() || ''}`;
    if (placement !== state.position) {
      if (position === 'bottom') { grid.moveViewTo(status, originalStatusLocation); }
      else if (position === 'top') { grid.moveViewTo(status, [0]); }
      else if (position === 'editor-top' || position === 'editor-bottom') { grid.moveView(status, status.minimumHeight, underPanel ? owner.panelPartView : owner.editorPartView, position === 'editor-top' ? 0 : 1); }
      state.position = placement;
    }
    const horizontal = config.activityBar?.position === 'bottom';
    if (horizontal !== state.horizontal) {
      if (horizontal) {
        state.placeholder = { element: document.createElement('div'), minimumWidth: 0, maximumWidth: 0, minimumHeight: 0, maximumHeight: Infinity, onDidChange: () => ({ dispose() {} }), layout() {} };
        grid.addView(state.placeholder, 0, activity, 3);
        grid.moveViewTo(activity, [grid.getViews().children.length]);
      } else {
        grid.moveView(activity, activity.minimumWidth, state.placeholder, 2);
        grid.removeView(state.placeholder);
        state.placeholder = undefined;
      }
      state.horizontal = horizontal;
      creatingActivity = true;
      try { activity.recreateCompositeBar(); }
      finally { creatingActivity = false; }
    }
    if (activity.element) {
      activity.element.classList.toggle('apc-horizontal-activitybar', horizontal);
      for (const [node, property, value, priority] of state.activityStyles) {
        if (!horizontal) { node.style.setProperty(property, value, priority); }
      }
      if (horizontal) {
        if (!horizontalStyle) {
          horizontalStyle = document.createElement('style');
          horizontalStyle.textContent = '.monaco-workbench .part.activitybar.apc-horizontal-activitybar .monaco-action-bar .actions-container{display:flex !important;flex-direction:row !important;align-items:center}.monaco-workbench .part.activitybar.apc-horizontal-activitybar .content>.composite-bar{flex:1;min-width:0}.monaco-workbench .part.activitybar.apc-horizontal-activitybar .content>.menubar{width:auto !important;flex:0 0 auto;align-self:center}.monaco-workbench .part.activitybar.apc-horizontal-activitybar .action-item{flex-shrink:0;margin-top:0 !important;margin-bottom:0 !important}';
          document.head.appendChild(horizontalStyle);
        }
        activity.element.style.setProperty('width', 'calc(100% - 8px)', 'important');
        activity.element.style.setProperty('height', 'calc(100% - 4px)', 'important');
        activity.content.style.display = 'flex';
        activity.content.style.flexDirection = 'row';
        const global = activity.compositeBar.value?.globalCompositeBar;
        if (global) {
          global.element.style.width = `${global.getHeight(activity.actionHeight, activity.actionGap)}px`;
          global.element.style.flex = '0 0 auto';
        }
      }
    }
    owner.layout();
    const activitySize = grid.getViewSize(activity);
    activity.layout(activitySize.width, activitySize.height);
    owner.sideBarPartView.relayout?.();
  }
  globalThis.__apcCustomizations = {
    activityOrientation() { return config.activityBar?.position === 'bottom' ? 0 : 1; },
    actionOrientation(container, fallback) { return config.activityBar?.position === 'bottom' && (creatingActivity || container?.closest('.part.activitybar')) ? 0 : fallback; },
    configure(value) {
      config = value || {};
      for (const node of tabStyles.keys()) { if (!node.isConnected) { tabStyles.delete(node); } }
      for (const entry of lists) {
        if (!entry.container.isConnected) { continue; }
        entry.view.items.forEach((item, index) => entry.view.updateElementHeight(index, entry.delegate.getHeight(item.element)));
      }
      for (const tabs of tabsControls) { if (tabs.parent.isConnected) { tabs.updateTabHeight(); styleTabs(tabs); } else { tabsControls.delete(tabs); } }
      for (const state of layouts) { applyLayout(state); }
    },
    list(view, container, delegate) {
      const height = element => {
        const settings = rowSettings(container);
        const fallback = delegate.getHeight(element);
        if (!settings) { return fallback; }
        if (element?.element?.placeholder) { return positive(settings.input, fallback); }
        if (element?.element?.type === 'actionButton') { return positive(settings.actionButton, fallback); }
        return positive(settings.height, fallback);
      };
      // Delegate methods may use private fields: retain their original receiver.
      const wrapped = new Proxy(delegate, { get(target, property) {
        if (property === 'getHeight') { return height; }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      const entry = { view, container, delegate: wrapped };
      lists.add(entry);
      queueMicrotask(() => view.disposables.add({ dispose: () => lists.delete(entry) }));
      return wrapped;
    },
    header(part, fallback) {
      if (!part.contentArea?.closest('.part.sidebar, .part.auxiliarybar, .part.panel')) { return fallback; }
      return positive(config['sidebar.titlebar']?.height, fallback);
    },
    tab(tabs, fallback) {
      tabsControls.add(tabs);
      queueMicrotask(() => styleTabs(tabs));
      const settings = config.header || {};
      return positive(tabs.groupsView.partOptions.tabHeight === 'compact' ? settings.compact ?? settings.height : settings.default ?? settings.height, fallback);
    },
    layout(owner) {
      const status = owner.statusBarPartView;
      const activity = owner.activityBarPartView;
      const titles = [owner.sideBarPartView, owner.auxiliaryBarPartView, owner.panelPartView].map(part => [part, part.titleArea?.style.height || '']);
      const activityStyles = [[activity.element, 'width'], [activity.element, 'height'], [activity.content, 'display'], [activity.content, 'flex-direction']].filter(([node]) => node).map(([node, property]) => [node, property, node.style.getPropertyValue(property), node.style.getPropertyPriority(property)]);
      const state = { owner, status, activity, titles, activityStyles, horizontal: false, grid: owner.workbenchGrid, originalStatusLocation: owner.workbenchGrid.getViewLocation(status), position: 'bottom' };
      const override = (object, property, read) => {
        const original = object[property];
        let prototype = object;
        let descriptor;
        while (prototype && !descriptor) { descriptor = Object.getOwnPropertyDescriptor(prototype, property); prototype = Object.getPrototypeOf(prototype); }
        Object.defineProperty(object, property, { configurable: true, get: () => read(descriptor?.get ? descriptor.get.call(object) : original) });
      };
      for (const property of ['minimumHeight', 'maximumHeight']) { override(status, property, fallback => positive(config.statusBar?.height, fallback)); }
      override(activity, 'minimumHeight', fallback => config.activityBar?.position === 'bottom' ? positive(config.activityBar.size, 48) : fallback);
      override(activity, 'maximumHeight', fallback => config.activityBar?.position === 'bottom' ? positive(config.activityBar.size, 48) : fallback);
      override(activity, 'minimumWidth', fallback => config.activityBar?.position === 'bottom' ? 0 : fallback);
      override(activity, 'maximumWidth', fallback => config.activityBar?.position === 'bottom' ? Infinity : fallback);
      if ('baseWidth' in activity) {
        override(activity, 'baseWidth', fallback => config.activityBar?.size ? Math.max(1, positive(config.activityBar.size, fallback) - activity.floatingHorizontalGutter) : fallback);
        override(activity, 'actionHeight', fallback => positive(config.activityBar?.itemSize, fallback));
        override(activity, 'actionGap', fallback => typeof config.activityBar?.itemMargin === 'number' ? Math.max(0, config.activityBar.itemMargin) : fallback);
      } else {
        for (const property of ['minimumWidth', 'maximumWidth']) { override(activity, property, fallback => positive(config.activityBar?.size, fallback)); }
      }
      layouts.add(state);
      // Native sidebar/panel alignment uses fixed grid locations. Restore that
      // topology around the native operation, then rebuild the APC placement.
      // Moving a horizontal bar through a native vertical slot would otherwise
      // constrain the whole content row to the bar's fixed height.
      const adjust = owner.adjustPartPositions;
      if (typeof adjust === 'function') {
        owner.adjustPartPositions = function (...args) {
          if (state.adjusting || (!state.horizontal && (!config.statusBar?.position || config.statusBar.position === 'bottom'))) {
            return adjust.apply(this, args);
          }
          const desired = config;
          state.adjusting = true;
          try {
            config = { ...desired, activityBar: { ...desired.activityBar, position: undefined }, statusBar: { ...desired.statusBar, position: 'bottom' } };
            applyLayout(state);
            return adjust.apply(this, args);
          } finally {
            config = desired;
            state.position = undefined;
            try { applyLayout(state); }
            finally { state.adjusting = false; }
          }
        };
        owner._register({ dispose() { owner.adjustPartPositions = adjust; layouts.delete(state); } });
      }
      for (const event of ['onDidChangePanelPosition', 'onDidChangePanelAlignment']) {
        const disposable = owner[event]?.(() => queueMicrotask(() => applyLayout(state)));
        if (disposable) { owner._register(disposable); }
      }
      const visibility = owner.onDidChangePartVisibility?.(event => {
        if (event.partId === 'workbench.parts.panel') { queueMicrotask(() => applyLayout(state)); }
      });
      if (visibility) { owner._register(visibility); }
      queueMicrotask(() => applyLayout(state));
    },
  };
})();
