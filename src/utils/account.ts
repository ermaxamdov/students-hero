/** Stable, non-secret identity used only to scope local account state. */
export function accountIdForUsername(username: string | undefined): string | null {
  const normalized = username?.trim().toLowerCase()
  return normalized ? `elms:${normalized}` : null
}
