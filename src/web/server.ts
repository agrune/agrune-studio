// Studio web backend (the human-facing surface, SPEC §1). A small Node HTTP server that exposes the
// EXISTING engine (scenario runner / repair / monkey / discovery / catalog) over JSON, plus serves
// the dashboard. The browser UI can't launch Playwright, so every run happens here (headless) and the
// per-step screenshots are served back to the UI. No engine logic is re-implemented — this only wires.

import http from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runScenario } from '../scenario/runner.js'
import { validateScenario, createEmptyScenario, ASSERTION_KINDS } from '../scenario/schema.js'
import { repairScenario } from '../scenario/heal.js'
import { runMonkey } from '../monkey/explore.js'
import { runDiscovery } from '../discover/discover.js'
import { listCatalog, installPack, runInstalled } from '../pack/catalog.js'
import { loadPublicKey, readKeysetEnvelope } from '../publish/keystore.js'

const WEB_DIR = fileURLToPath(new URL('../../web/', import.meta.url))
const RUNS_DIR = join(WEB_DIR, 'runs')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

let runCounter = 0
function nextRunId(): string {
  runCounter += 1
  return `${Date.now()}-${runCounter}`
}

interface JsonResult {
  status: number
  body: unknown
}

export interface ServeOptions {
  port?: number
  host?: string
}

export async function startServer(opts: ServeOptions = {}): Promise<{ url: string; close: () => Promise<void> }> {
  await mkdir(RUNS_DIR, { recursive: true })
  const host = opts.host ?? '127.0.0.1'
  const port = opts.port ?? 4180

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      sendJson(res, { status: 500, body: { error: (err as Error).message } })
    })
  })

  await new Promise<void>((resolve) => server.listen(port, host, resolve))
  const url = `http://${host}:${port}`
  return {
    url,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost')
  const path = url.pathname

  if (req.method === 'POST' && path.startsWith('/api/')) {
    const body = await readBody(req)
    sendJson(res, await route(path, body))
    return
  }
  if (req.method === 'GET' && path === '/api/meta') {
    sendJson(res, { status: 200, body: { assertions: ASSERTION_KINDS, sample: createEmptyScenario('my scenario') } })
    return
  }
  if (req.method === 'GET') {
    await serveStatic(path, res)
    return
  }
  sendJson(res, { status: 405, body: { error: 'method not allowed' } })
}

async function route(path: string, body: Record<string, unknown>): Promise<JsonResult> {
  try {
    switch (path) {
      case '/api/scenario/validate': {
        const result = validateScenario(body.scenario)
        return { status: 200, body: result }
      }
      case '/api/scenario/run': {
        const scenario = requireScenario(body.scenario)
        const runId = nextRunId()
        const report = await runScenario(scenario, {
          ...(typeof body.url === 'string' ? { url: body.url } : {}),
          artifactsDir: join(RUNS_DIR, runId),
          screenshots: true,
        })
        rewriteShots(report.steps, runId)
        return { status: 200, body: report }
      }
      case '/api/scenario/repair': {
        const scenario = requireScenario(body.scenario)
        const report = await repairScenario(scenario, {
          ...(typeof body.url === 'string' ? { url: body.url } : {}),
        })
        return { status: 200, body: report }
      }
      case '/api/monkey': {
        const report = await runMonkey({
          url: String(body.url ?? ''),
          ...(body.steps ? { maxSteps: Number(body.steps) } : {}),
          ...(body.seed !== undefined ? { seed: Number(body.seed) } : {}),
        })
        return { status: 200, body: report }
      }
      case '/api/discover': {
        const existing = Array.isArray(body.existing)
          ? (body.existing as unknown[]).map((s) => validateScenario(s)).flatMap((r) => (r.ok ? [r.scenario] : []))
          : []
        const report = await runDiscovery({ url: String(body.url ?? ''), existing })
        return { status: 200, body: report }
      }
      case '/api/catalog/list': {
        const { rootKey, keyset, store } = await catalogTrust(body)
        const items = await listCatalog(store, rootKey, keyset)
        return { status: 200, body: { items } }
      }
      case '/api/catalog/install': {
        const { rootKey, keyset, store } = await catalogTrust(body)
        const result = await installPack(store, String(body.origin), String(body.version), String(body.dest), rootKey, keyset)
        return { status: 200, body: result }
      }
      case '/api/catalog/run': {
        const installDir = join(String(body.dest), encodeURIComponent(String(body.origin)))
        const result = await runInstalled(installDir, String(body.url))
        return { status: 200, body: result }
      }
      default:
        return { status: 404, body: { error: `unknown endpoint: ${path}` } }
    }
  } catch (err) {
    return { status: 400, body: { error: (err as Error).message } }
  }
}

async function catalogTrust(body: Record<string, unknown>) {
  const store = String(body.store ?? '')
  const rootKey = loadPublicKey(String(body.root ?? ''), 'root key')
  const keyset = await readKeysetEnvelope(String(body.keyset ?? ''))
  return { store, rootKey, keyset }
}

function requireScenario(raw: unknown) {
  const result = validateScenario(raw)
  if (!result.ok) throw new Error(`invalid scenario: ${result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`)
  return result.scenario
}

function rewriteShots(steps: Array<{ screenshot?: string }>, runId: string): void {
  for (const s of steps) {
    if (s.screenshot) s.screenshot = `/runs/${runId}/${basename(s.screenshot)}`
  }
}

// ---- static + helpers ------------------------------------------------------

async function serveStatic(path: string, res: http.ServerResponse): Promise<void> {
  let filePath: string
  if (path.startsWith('/runs/')) {
    filePath = join(RUNS_DIR, normalize(path.slice('/runs/'.length)))
    if (!filePath.startsWith(RUNS_DIR)) return send(res, 403, 'text/plain', 'forbidden')
  } else {
    const rel = path === '/' ? 'index.html' : normalize(path.replace(/^\/+/, ''))
    filePath = join(WEB_DIR, rel)
    if (!filePath.startsWith(WEB_DIR)) return send(res, 403, 'text/plain', 'forbidden')
    if (!existsSync(filePath)) filePath = join(WEB_DIR, 'index.html') // SPA fallback
  }
  try {
    const data = await readFile(filePath)
    send(res, 200, MIME[extname(filePath)] ?? 'application/octet-stream', data)
  } catch {
    send(res, 404, 'text/plain', 'not found')
  }
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (c) => {
      raw += c
      if (raw.length > 8 * 1024 * 1024) {
        reject(new Error('request too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {})
      } catch (e) {
        reject(e as Error)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: http.ServerResponse, result: JsonResult): void {
  send(res, result.status, MIME['.json']!, JSON.stringify(result.body))
}

function send(res: http.ServerResponse, status: number, contentType: string, body: string | Buffer): void {
  res.writeHead(status, { 'content-type': contentType })
  res.end(body)
}
