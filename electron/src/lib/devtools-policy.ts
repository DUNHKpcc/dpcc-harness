interface DevToolsPolicyInput {
  isPackaged: boolean;
  glassEnabled: boolean;
}

export function shouldEnableRendererDevTools({ isPackaged, glassEnabled }: DevToolsPolicyInput): boolean {
  return !isPackaged && !glassEnabled;
}

export function shouldEnableRemoteDevTools({ isPackaged, glassEnabled }: DevToolsPolicyInput): boolean {
  return !isPackaged && glassEnabled;
}

export function shouldRegisterDevToolsShortcuts(isPackaged: boolean): boolean {
  return !isPackaged;
}

export function canOpenAppDevTools(isPackaged: boolean): boolean {
  return !isPackaged;
}

export function shouldDisableApplicationMenu(isPackaged: boolean): boolean {
  return isPackaged;
}
