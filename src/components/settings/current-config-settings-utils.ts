export function shouldApplyConfigSourceRefresh(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}
