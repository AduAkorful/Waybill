import { createWaybillApiClient, loadBrowserApiBaseUrl, WaybillApiError } from '@/integration/api'
import { getBrowserNetwork } from '@/integration/network'
import { parseAttestor, parseAttestors, type Attestor } from '@/view/attestor'

export type AttestorRead<T> =
  | { status: 'ready'; value: T }
  | { status: 'unconfigured' }
  | { status: 'missing' }
  | { status: 'error'; message: string }

function api() {
  try {
    return createWaybillApiClient(loadBrowserApiBaseUrl(), fetch, getBrowserNetwork())
  } catch {
    return null
  }
}

/** The directory, from the relayer. When the API is not configured or fails, that is the result: nothing is invented. */
export async function getAttestors(): Promise<AttestorRead<Attestor[]>> {
  const client = api()
  if (!client) return { status: 'unconfigured' }
  try {
    return { status: 'ready', value: parseAttestors(await client.getAttestors()) }
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) }
  }
}

export async function getAttestor(address: string): Promise<AttestorRead<Attestor>> {
  const client = api()
  if (!client) return { status: 'unconfigured' }
  try {
    return { status: 'ready', value: parseAttestor(await client.getAttestor(address)) }
  } catch (e) {
    if (e instanceof WaybillApiError && e.status === 404) return { status: 'missing' }
    return { status: 'error', message: e instanceof Error ? e.message : String(e) }
  }
}
