import * as vscode from 'vscode';
export function getConfiguration<T>(configuration: string) {
  const config = vscode.workspace.getConfiguration();
  return config.get<T>(configuration);
}

function generateStyleFomObject(obj: Record<string, string>, styles = '') {
  for (const property in obj) {
    const value = obj[property];
    if (['number', 'string'].includes(typeof value)) { styles += `${property}: ${value}; `; }
  }
  return styles;
}

export function getStyles(styleSheet: Record<string, string>, style = '') {
  for (const selector in styleSheet) {
    const value = styleSheet[selector];
    const styles = typeof value === 'string' ? value : typeof value === 'object' ? generateStyleFomObject(value) : '';
    style += `${selector} { ${styles} }\n\t\t\t`;
  }
  return style;
}
