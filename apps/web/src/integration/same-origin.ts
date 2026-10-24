/**
 * A path-only URL setting such as `/rpc` means "this site's own origin". In the browser that is the page's origin, so
 * one build works on localhost and behind a tunnel. On the server (prerender, SSR) there is no page, so it resolves
 * against WAYBILL_SERVER_ORIGIN, the address this server can reach its own proxy on.
 */
export function resolveSameOrigin(value: string, name: string): string {
  if (!value.startsWith('/')) return value
  const base =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : process.env.WAYBILL_SERVER_ORIGIN?.trim()
  if (!base) throw new Error(`${name} is a path (${value}); set WAYBILL_SERVER_ORIGIN for server-side reads`)
  return new URL(value, base).toString().replace(/\/+$/, '')
}
