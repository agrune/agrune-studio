// `agrune-studio serve` — launch the Studio web dashboard.

import { startServer } from './server.js'

export async function runServeCli(argv: string[]): Promise<number> {
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) continue
    const name = arg.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) flags.set(name, true)
    else {
      flags.set(name, next)
      i += 1
    }
  }
  const port = typeof flags.get('port') === 'string' ? Number(flags.get('port')) : 4180
  const host = typeof flags.get('host') === 'string' ? (flags.get('host') as string) : '127.0.0.1'

  const { url } = await startServer({ port, host })
  console.log(`Agrune Studio is running at ${url}`)
  console.log('Open it in your browser. Press Ctrl+C to stop.')
  // keep the process alive (the http server holds it open)
  return new Promise<number>(() => {})
}
