// `agrune-studio record` — 헤디드 QA 모드 캡처를 시작한다. Ctrl+C로 종료하면 트레일 저장 + 추출.

import path from 'node:path'
import { startRecording } from './capture.js'
import { extractScenario } from './extract.js'

export interface RecordArgs {
  url: string
  out?: string
  headless: boolean
}

export function parseRecordArgs(argv: string[]): RecordArgs {
  let url: string | undefined
  let out: string | undefined
  let headless = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === '--url') {
      url = argv[i + 1]
      i += 1
    } else if (arg === '--out') {
      out = argv[i + 1]
      i += 1
    } else if (arg === '--headless') {
      headless = true
    }
  }
  if (!url || url.startsWith('--')) throw new Error('missing --url <app>')
  return out ? { url, out, headless } : { url, headless }
}

export async function runRecordCli(argv: string[]): Promise<number> {
  const args = parseRecordArgs(argv)
  const dir = args.out ?? path.join(process.cwd(), 'web', 'runs', 'recordings', `${Date.now()}`)
  const ctrl = await startRecording({ url: args.url, artifactsDir: dir, headless: args.headless })
  console.log(`Recording ${args.url} → ${dir}`)
  console.log('QA 모드 창에서 앱을 조작하세요. Ctrl+C로 종료하면 트레일을 저장하고 시나리오를 출력합니다.')
  await new Promise<void>((resolve) => {
    const finish = () => resolve()
    process.once('SIGINT', finish)
    process.once('SIGTERM', finish)
  })
  const recording = await ctrl.stop()
  const { scenario, gaps } = extractScenario(recording, { name: 'recorded flow' })
  console.log(JSON.stringify(scenario, null, 2))
  if (gaps.length > 0) {
    console.error(`\n${gaps.length} unmapped action(s) — 매니페스트에 추가해야 테스트로 박힙니다:`)
    for (const g of gaps) console.error(`  - entry #${g.index}: ${g.rawTarget?.css ?? g.rawTarget?.tag ?? '?'} (${g.reason})`)
  }
  return 0
}
