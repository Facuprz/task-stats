import type { AgentRow, Run, TaskItem } from '../types'

/** A filled bar of `width` cells for a 0..1 fraction. */
export function bar(fraction: number, width: number): string {
  const f = Math.max(0, Math.min(1, fraction))
  const full = Math.round(f * width)
  return '█'.repeat(full) + '░'.repeat(width - full)
}

/** An indeterminate bar: a 3-cell block sweeping back and forth with time. */
export function sweep(now: number, width: number): string {
  const block = 3
  const span = Math.max(1, width - block)
  const step = Math.floor(now / 500) % (span * 2)
  const pos = step < span ? step : span * 2 - step
  return '░'.repeat(pos) + '▓'.repeat(block) + '░'.repeat(width - block - pos)
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function money(usd: number): string {
  return `$${usd.toFixed(2)}`
}

export function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

/** 'normal' under 70, 'warning' 70..90, 'error' from 90. */
export function level(percent: number): 'warning' | 'error' | undefined {
  if (percent >= 90) return 'error'
  if (percent >= 70) return 'warning'
  return undefined
}

/** "en 2h13m" until an ISO reset time. */
export function resetIn(resetsAt: string | undefined, now: number): string | undefined {
  if (!resetsAt) return undefined
  const at = Date.parse(resetsAt)
  if (Number.isNaN(at)) return undefined
  return `reset en ${duration(Math.max(0, at - now)).replace(/\d+s$/, '') || '0m'}`
}

/** Task-list progress of one loop in this run, or null when it has none. */
export function progressOf(tasks: readonly TaskItem[], loop: string) {
  const mine = tasks.filter(t => t.loop === loop && t.inRun)
  if (mine.length === 0) return null
  const done = mine.filter(t => t.status === 'completed').length
  const current = mine.find(t => t.status === 'in_progress')
  return { done, total: mine.length, current: current?.subject }
}

export function isRunActive(run: Run | null): boolean {
  return run !== null && run.endedAt === undefined
}

export function runningAgents(agents: readonly AgentRow[]) {
  return agents.filter(a => a.status === 'running')
}

/** Agents ordered as a tree: each followed by its children, with depth. */
export function tree(agents: readonly AgentRow[]): { agent: AgentRow; depth: number }[] {
  const ids = new Set(agents.map(a => a.id))
  const out: { agent: AgentRow; depth: number }[] = []
  const walk = (parent: string | undefined, depth: number) => {
    for (const a of agents) {
      const p = a.parentId && ids.has(a.parentId) ? a.parentId : undefined
      if (p === parent) {
        out.push({ agent: a, depth })
        if (depth < 8) walk(a.id, depth + 1)
      }
    }
  }
  walk(undefined, 0)
  return out
}

/** A short label for a tool call: "Bash: npm test". */
export function toolLabel(tool: string, input: Record<string, unknown>): string {
  const pick = ['description', 'command', 'file_path', 'pattern', 'query', 'url', 'path', 'subject', 'prompt']
  for (const k of pick) {
    const v = input[k]
    if (typeof v === 'string' && v.trim()) {
      const one = v.trim().split('\n')[0] ?? ''
      return `${tool}: ${one.length > 48 ? one.slice(0, 47) + '…' : one}`
    }
  }
  return tool
}
