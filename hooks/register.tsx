import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionUsage } from 'claude-code'

import type { AgentRow, Run, TaskItem, Usage } from '../types'
import {
  bar,
  duration,
  isRunActive,
  level,
  money,
  progressOf,
  resetIn,
  runningAgents,
  shortModel,
  sweep,
  tokens,
  toolLabel,
  tree,
} from './format'

const P = 'task-stats'
const PANE = 'task-stats-agents'
const PANE_TITLE = 'Agentes'

// Change a tag when that value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const runAtom = atom({ plugin: 'task-stats', key: 'run' } as const, null, { shape: 'run-1' })
const agentsAtom = atom({ plugin: 'task-stats', key: 'agents' } as const, [], { shape: 'agents-1' })
const tasksAtom = atom({ plugin: 'task-stats', key: 'tasks' } as const, [], { shape: 'tasks-1' })
const usageAtom = atom({ plugin: 'task-stats', key: 'usage' } as const, {}, { shape: 'usage-1' })
const warnedAtom = atom({ plugin: 'task-stats', key: 'warnedReset' } as const, null)

type $T = EngineInterface

const loopOf = (agentId: string | undefined) => agentId ?? 'main'

const spent = (u: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number } | null | undefined) =>
  u ? u.input_tokens + u.cache_creation_input_tokens + u.output_tokens : 0

function toUsage(u: { rateLimits: readonly SessionRateLimit[]; context: { percent?: number }; cost?: { usd: number } }): Usage {
  const five = u.rateLimits.find(r => r.kind === 'five_hour')
  const seven = u.rateLimits.find(r => r.kind === 'seven_day')
  return {
    fiveHour: five && { percent: five.percentUsed, resetsAt: five.resetsAt },
    sevenDay: seven && { percent: seven.percentUsed, resetsAt: seven.resetsAt },
    contextPercent: u.context.percent,
    costUsd: u.cost?.usd,
  }
}

async function storeUsage($: $T, u: Usage) {
  await update($, usageAtom, () => u)
  const five = u.fiveHour
  if (five && five.percent >= 90) {
    const key = five.resetsAt ?? 'unknown'
    if ((await read($, warnedAtom)) !== key) {
      await update($, warnedAtom, () => key)
      $.ui.toast(`Usaste el ${Math.round(five.percent)}% de la ventana de 5h`)
    }
  }
}

/** Ends the run once the main loop and every agent have finished. */
async function settleRun($: $T) {
  const agents = await read($, agentsAtom)
  if (runningAgents(agents).length > 0) return
  const now = await $.clock.now()
  await update($, runAtom, run =>
    run && run.mainEndedAt !== undefined && run.endedAt === undefined ? { ...run, endedAt: now } : run,
  )
}

async function beginRun($: $T) {
  const now = await $.clock.now()
  const keep = runningAgents(await read($, agentsAtom))
  const keepIds = new Set(keep.map(a => a.id))
  await update($, agentsAtom, () => keep)
  await update($, tasksAtom, list =>
    list
      .filter(t => t.loop === 'main' || keepIds.has(t.loop))
      .map(t => (t.loop === 'main' ? { ...t, inRun: t.status !== 'completed' } : t)),
  )
  const run: Run = { startedAt: now, steps: 0, tokens: 0 }
  await update($, runAtom, () => run)
}

async function upsertAgent($: $T, id: string, patch: Partial<AgentRow>) {
  const now = await $.clock.now()
  await update($, agentsAtom, list => {
    const found = list.find(a => a.id === id)
    if (found) return list.map(a => (a.id === id ? { ...a, ...patch } : a))
    const fresh: AgentRow = {
      id,
      description: 'Subagente',
      type: 'agent',
      model: '',
      isBackground: false,
      status: 'running',
      startedAt: now,
      steps: 0,
      tokens: 0,
      ...patch,
    }
    return [...list, fresh].slice(-60)
  })
}

export const register: Register = on => {
  let paneOpenedFor = -1

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'task-stats',
      description: 'Abre el panel en vivo de agentes de task-stats',
    })
    try {
      await storeUsage($, toUsage((await $.session.usage()) as SessionUsage))
    } catch {
      // usage figures are optional; the band shows what it has
    }
    // Redraw once a second while a run is active, so elapsed times and the
    // indeterminate bars move.
    $.clock.every(1000, () => {
      void read($, runAtom).then(run => {
        if (isRunActive(run)) $.ui.invalidate('ui.render')
      })
    })
    return next(e)
  })

  on('command.run', { command: 'task-stats' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: PANE_TITLE })
    return { text: opened.isPlaced ? 'Panel de agentes abierto.' : 'El panel de agentes se abre cuando haya lugar.' }
  })

  on('session.measure', async ($, e, next) => {
    await storeUsage($, toUsage(e))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await beginRun($)
    } else {
      await upsertAgent($, e.agentId, { status: 'running', endedAt: undefined })
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const used = spent(result.usage)
    if (e.agentId === undefined) {
      await update($, runAtom, run => run && { ...run, steps: run.steps + 1, tokens: run.tokens + used })
    } else {
      const id = e.agentId
      await update($, agentsAtom, list =>
        list.map(a => (a.id === id ? { ...a, steps: a.steps + 1, tokens: a.tokens + used, model: a.model || e.model } : a)),
      )
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    if (e.agentId === undefined) {
      await update($, runAtom, run => run && { ...run, mainEndedAt: now })
    } else {
      const failed = e.isAborted || e.reason === 'error'
      await upsertAgent($, e.agentId, { status: failed ? 'failed' : 'done', endedAt: now })
    }
    await settleRun($)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined || !started.agentId) return started
    await upsertAgent($, started.agentId, {
      parentId: e.parentAgentId,
      description: e.name ?? e.description,
      type: e.subagentType,
      model: started.model,
      isBackground: e.background,
      status: 'running',
    })
    const run = await read($, runAtom)
    if (run && paneOpenedFor !== run.startedAt) {
      paneOpenedFor = run.startedAt
      void $.ui.open({ id: PANE, title: PANE_TITLE })
    }
    return started
  })

  // Task lists: TaskCreate / TaskUpdate (shared list) and TodoWrite (per loop).
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const id = (ran.result as { task?: { id?: string } } | undefined)?.task?.id
    if (id) {
      const item: TaskItem = { id, subject: e.subject, status: 'pending', loop: loopOf(e.agentId), inRun: true }
      await update($, tasksAtom, list => [...list.filter(t => t.id !== id), item].slice(-200))
    }
    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    if ((ran.result as { success?: boolean } | undefined)?.success) {
      const status = e.status
      await update($, tasksAtom, (list): TaskItem[] =>
        status === 'deleted'
          ? list.filter(t => t.id !== e.taskId)
          : list.map(t =>
              t.id === e.taskId
                ? { ...t, inRun: true, subject: e.subject ?? t.subject, status: status ?? t.status }
                : t,
            ),
      )
    }
    return ran
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    const loop = loopOf(e.agentId)
    const todos: TaskItem[] = e.todos.map((t, i) => ({
      id: `todo:${loop}:${i}`,
      subject: t.status === 'in_progress' ? t.activeForm || t.content : t.content,
      status: t.status,
      loop,
      inRun: true,
    }))
    await update($, tasksAtom, list => [...list.filter(t => !(t.loop === loop && t.id.startsWith('todo:'))), ...todos])
    return ran
  })

  // The last thing each loop did.
  on('tool.call', async ($, e, next) => {
    const label = toolLabel(String(e.tool), e as unknown as Record<string, unknown>)
    if (e.agentId === undefined) {
      await update($, runAtom, run => run && { ...run, lastTool: label })
    } else {
      const id = e.agentId
      await update($, agentsAtom, list => list.map(a => (a.id === id ? { ...a, lastTool: label } : a)))
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const [run, agents, tasks, usage] = await Promise.all([
      read($, runAtom),
      read($, agentsAtom),
      read($, tasksAtom),
      read($, usageAtom),
    ])
    const width = e.props.bodyColumns

    // Usage line.
    const parts: JSX.Element[] = []
    const sep = () => <Text dimColor> │ </Text>
    if (usage.fiveHour) {
      const p = usage.fiveHour.percent
      parts.push(
        <Text color={level(p)}>
          5h {bar(p / 100, 10)} {Math.round(p)}%
        </Text>,
      )
      const reset = resetIn(usage.fiveHour.resetsAt, now)
      if (reset) parts.push(<Text dimColor> · {reset}</Text>)
    }
    if (usage.sevenDay && usage.sevenDay.percent > 70) {
      if (parts.length) parts.push(sep())
      parts.push(<Text color={level(usage.sevenDay.percent)}>7d {Math.round(usage.sevenDay.percent)}%</Text>)
    }
    if (usage.contextPercent !== undefined) {
      if (parts.length) parts.push(sep())
      parts.push(<Text color={level(usage.contextPercent)}>ctx {Math.round(usage.contextPercent)}%</Text>)
    }
    if (usage.costUsd !== undefined) {
      if (parts.length) parts.push(sep())
      parts.push(<Text dimColor>{money(usage.costUsd)}</Text>)
    }
    const usageLine = parts.length ? <Text wrap="truncate">{parts}</Text> : null

    // Task line.
    let taskLine: JSX.Element | null = null
    if (run) {
      const running = runningAgents(agents)
      const bg = running.filter(a => a.isBackground).length
      const agentTokens = agents.reduce((n, a) => n + a.tokens, 0)
      const agentNote =
        agents.length > 0
          ? ` · ${agents.length} ${agents.length === 1 ? 'agente' : 'agentes'}` +
            (running.length ? ` · ${running.length} corriendo` : '') +
            (bg ? ` · ${bg} en background` : '')
          : ''
      if (run.endedAt !== undefined) {
        taskLine = (
          <Text wrap="truncate">
            <Text color="success">✓ </Text>
            <Text dimColor>
              {duration(run.endedAt - run.startedAt)} · {tokens(run.tokens + agentTokens)} tokens{agentNote}
            </Text>
          </Text>
        )
      } else {
        const prog = progressOf(tasks, 'main')
        const barWidth = width >= 100 ? 20 : 12
        const head = prog ? (
          <Text>
            <Text color="claude">{bar(prog.done / prog.total, barWidth)}</Text> {prog.done}/{prog.total}
            {prog.current ? <Text> · {prog.current}</Text> : null}
          </Text>
        ) : (
          <Text color="claude">{sweep(now, barWidth)}</Text>
        )
        taskLine = (
          <Text wrap="truncate">
            <Text color="claude">▶ </Text>
            {head}
            <Text dimColor>
              {' '}
              · {duration(now - run.startedAt)} · {run.steps} {run.steps === 1 ? 'paso' : 'pasos'} · {tokens(run.tokens + agentTokens)} tok{agentNote}
            </Text>
          </Text>
        )
      }
    }

    if (!taskLine && !usageLine) return next(e)
    return (
      <Box flexDirection="column">
        {taskLine}
        {usageLine}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const [agents, tasks] = await Promise.all([read($, agentsAtom), read($, tasksAtom)])
    if (agents.length === 0) {
      return <Text dimColor>Sin subagentes en esta task.</Text>
    }
    const running = runningAgents(agents).length
    const barWidth = Math.max(6, Math.min(16, e.props.bodyColumns - 40))
    return (
      <Box flexDirection="column">
        <Text dimColor>
          {agents.length} {agents.length === 1 ? 'agente' : 'agentes'} · {running} corriendo
        </Text>
        {tree(agents).map(({ agent: a, depth }) => {
          const indent = '  '.repeat(depth)
          const prog = progressOf(tasks, a.id)
          const isDone = a.status !== 'running'
          const icon = a.status === 'running' ? '●' : a.status === 'done' ? '✓' : '✗'
          const iconColor = a.status === 'running' ? 'claude' : a.status === 'done' ? 'success' : 'error'
          const barText = prog
            ? `${bar(prog.done / prog.total, barWidth)} ${prog.done}/${prog.total}`
            : isDone
              ? bar(1, barWidth)
              : sweep(now, barWidth)
          const elapsed = duration((a.endedAt ?? now) - a.startedAt)
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text wrap="truncate" dimColor={isDone}>
                {indent}
                <Text color={iconColor}>{icon} </Text>
                <Text bold={!isDone}>{a.description}</Text>
                <Text dimColor>
                  {' '}
                  {a.type}
                  {a.model ? ` · ${shortModel(a.model)}` : ''}
                  {a.isBackground ? ' · bg' : ''}
                </Text>
              </Text>
              <Text wrap="truncate" dimColor={isDone}>
                {indent}
                {'  '}
                <Text color={isDone ? undefined : 'claude'}>{barText}</Text>
                <Text dimColor>
                  {' '}
                  · {elapsed} · {a.steps} {a.steps === 1 ? 'paso' : 'pasos'} · {tokens(a.tokens)} tok
                </Text>
              </Text>
              {a.lastTool && !isDone ? (
                <Text wrap="truncate" dimColor>
                  {indent}
                  {'  '}↳ {a.lastTool}
                </Text>
              ) : null}
            </Box>
          )
        })}
      </Box>
    )
  })
}
