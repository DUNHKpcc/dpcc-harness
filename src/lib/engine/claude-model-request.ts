export interface ClaudeModelRequestIdentity {
  sessionId: string | null;
  generation: number;
}

export function isClaudeModelRequestCurrent(
  captured: ClaudeModelRequestIdentity,
  current: ClaudeModelRequestIdentity,
): boolean {
  return captured.sessionId === current.sessionId
    && captured.generation === current.generation;
}

export function isClaudeModelCacheRequestCurrent(
  capturedGeneration: number,
  currentGeneration: number,
): boolean {
  return capturedGeneration === currentGeneration;
}
