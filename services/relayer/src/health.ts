export interface HealthCheck {
  name: string
  required: boolean
  check(): Promise<string | void>
}

export interface HealthComponentResult {
  name: string
  ok: boolean
  required: boolean
  detail?: string
}

export interface HealthResult {
  live: true
  ready: boolean
  components: HealthComponentResult[]
}

export async function checkHealth(checks: readonly HealthCheck[]): Promise<HealthResult> {
  const components = await Promise.all(
    checks.map(async (check): Promise<HealthComponentResult> => {
      try {
        const detail = await check.check()
        return { name: check.name, required: check.required, ok: true, ...(detail ? { detail } : {}) }
      } catch (error) {
        return {
          name: check.name,
          required: check.required,
          ok: false,
          detail: error instanceof Error ? error.message : 'Unknown health failure',
        }
      }
    }),
  )
  return {
    live: true,
    ready: components.every((component) => !component.required || component.ok),
    components,
  }
}

export function rpcHealth(name: string, getBlockNumber: () => Promise<bigint>): HealthCheck {
  return {
    name,
    required: true,
    async check() {
      const block = await getBlockNumber()
      if (block < 0n) throw new Error('RPC returned a negative block')
      return `head=${block.toString()}`
    },
  }
}

export function databaseHealth(
  name: string,
  query: () => Promise<unknown>,
): HealthCheck {
  return {
    name,
    required: true,
    async check() {
      await query()
    },
  }
}
