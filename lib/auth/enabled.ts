/** True when Microsoft Entra ID credentials are configured. Auth is optional so
 *  local/dev runs without a login wall; it activates automatically in prod. */
export function authEnabled(): boolean {
  return !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID && !!process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
}
