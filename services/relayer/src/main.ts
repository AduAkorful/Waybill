import { createBackendApplication } from './bootstrap'

const app = createBackendApplication(process.env)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.stop().then(() => process.exit(0))
  })
}

await app.start()
