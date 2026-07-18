interface DevToolsPolicyInput {
  isPackaged: boolean;
  glassEnabled: boolean;
  diagnosticBuild: boolean;
}

function canUseAppDevTools(isPackaged: boolean, diagnosticBuild: boolean): boolean {
  return !isPackaged || diagnosticBuild;
}

export function shouldEnableRendererDevTools({ isPackaged, glassEnabled, diagnosticBuild }: DevToolsPolicyInput): boolean {
  return canUseAppDevTools(isPackaged, diagnosticBuild) && !glassEnabled;
}

export function shouldEnableRemoteDevTools({ isPackaged, glassEnabled, diagnosticBuild }: DevToolsPolicyInput): boolean {
  return canUseAppDevTools(isPackaged, diagnosticBuild) && glassEnabled;
}

export function shouldRegisterDevToolsShortcuts(isPackaged: boolean, diagnosticBuild: boolean): boolean {
  return canUseAppDevTools(isPackaged, diagnosticBuild);
}

export function canOpenAppDevTools(isPackaged: boolean, diagnosticBuild: boolean): boolean {
  return canUseAppDevTools(isPackaged, diagnosticBuild);
}

export function shouldDisableApplicationMenu(isPackaged: boolean): boolean {
  return isPackaged;
}
