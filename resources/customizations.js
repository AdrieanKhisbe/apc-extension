// Loaded before the workbench bundle; the same singleton receives live settings.
(() => {
  if (globalThis.__apcCustomizations) { return; }
  let config = {};
  const lists = new Set();
  const layouts = new Set();
  const tabsControls = new Set();
  const tabStyles = new Map();
  const defaults = ['customview-tree', 'results', 'open-editors', 'explorer-folders-view', 'outline-tree', 'scm-view', 'debug-view-content', 'debug-breakpoints', 'tree'];
  const positive = (value, fallback) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 512 ? value : fallback;
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
    if (position !== state.position) {
      if (position === 'bottom') { grid.moveViewTo(status, originalStatusLocation); }
      else if (position === 'top') { grid.moveViewTo(status, [0]); }
      else if (position === 'editor-top' || position === 'editor-bottom') { grid.moveView(status, status.minimumHeight, owner.editorPartView, position === 'editor-top' ? 0 : 1); }
      state.position = position;
    }
    owner.layout();
    owner.sideBarPartView.relayout?.();
  }
  globalThis.__apcCustomizations = {
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
      const state = { owner, status, activity, titles, grid: owner.workbenchGrid, originalStatusLocation: owner.workbenchGrid.getViewLocation(status), position: 'bottom' };
      const override = (object, property, read) => {
        const original = object[property];
        let prototype = object;
        let descriptor;
        while (prototype && !descriptor) { descriptor = Object.getOwnPropertyDescriptor(prototype, property); prototype = Object.getPrototypeOf(prototype); }
        Object.defineProperty(object, property, { configurable: true, get: () => read(descriptor?.get ? descriptor.get.call(object) : original) });
      };
      for (const property of ['minimumHeight', 'maximumHeight']) { override(status, property, fallback => positive(config.statusBar?.height, fallback)); }
      if ('baseWidth' in activity) {
        override(activity, 'baseWidth', fallback => config.activityBar?.size ? Math.max(1, positive(config.activityBar.size, fallback) - activity.floatingHorizontalGutter) : fallback);
        override(activity, 'actionHeight', fallback => positive(config.activityBar?.itemSize, fallback));
        override(activity, 'actionGap', fallback => typeof config.activityBar?.itemMargin === 'number' ? Math.max(0, config.activityBar.itemMargin) : fallback);
      } else {
        for (const property of ['minimumWidth', 'maximumWidth']) { override(activity, property, fallback => positive(config.activityBar?.size, fallback)); }
      }
      layouts.add(state);
      queueMicrotask(() => applyLayout(state));
    },
  };
})();
