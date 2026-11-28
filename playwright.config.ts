import { defineConfig, devices } from '@playwright/test'

const port = process.env.E2E_PORT ?? '43301'
const url = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: url,
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort --bypass-lock`,
    url,
    reuseExistingServer: false,
  },
})
