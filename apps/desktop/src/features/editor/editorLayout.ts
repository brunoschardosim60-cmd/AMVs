export function clampTimelineHeight(requested: number, workspaceHeight: number): number {
  const maximum = Math.max(96, workspaceHeight - 280);
  const minimum = Math.min(160, maximum);
  return Math.round(Math.max(minimum, Math.min(maximum, requested)));
}