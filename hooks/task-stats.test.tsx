import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'task-stats',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as const

const PANE = {
  plugin: 'task-stats',
  component: 'Pane',
  requestId: 'task-stats-agents',
  props: {
    title: 'Agentes',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const USAGE = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 90000, cache_creation_input_tokens: 500 }

test('a run with a task list and a subagent shows in the band and the pane', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-11-02T12:00:00Z') })
  on('command.register', () => ({ value: { command: 'task-stats' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000, tokens: 82000, percent: 41 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 62, resetsAt: '2026-11-02T14:13:00Z' },
        { kind: 'seven_day', percentUsed: 74 },
      ],
      cost: { usd: 3.12 },
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('agent.spawn', () => ({ model: 'claude-haiku-4-5', agentId: 'a1' }))
  on('tool.call', (_, e) =>
    e.tool === 'TaskCreate'
      ? { result: { task: { id: String(e.subject.length), subject: e.subject } } }
      : e.tool === 'TaskUpdate'
        ? { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
        : { result: {} },
  )
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE, model: e.model } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'hacé algo', turnId: 't1' })

  await $.tool.call({ tool: 'TaskCreate', subject: 'uno', description: '' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'dos!', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '3', status: 'completed' })

  await $.agent.spawn({
    tool_use_id: 'tu1',
    prompt: 'explorá',
    description: 'Explorar código',
    subagentType: 'Explore',
    provider: { kind: 'model', model: 'claude-opus-5-5' } as never,
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  })
  for await (const _ of $.turn.step({ turnId: 'ta', index: 0, model: 'claude-haiku-4-5', messageCount: 1, agentId: 'a1' })) {
    // drain
  }
  await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'a1' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface })
    const texts = (await band.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(texts).toMatch(/1\/2/)
    expect(texts).toMatch(/1 agente · 1 corriendo · 1 en background/)
    expect(texts).toMatch(/5h .* 62%/)
    expect(texts).toMatch(/7d 74%/)
    expect(texts).toMatch(/ctx 41%/)
    expect(texts).toMatch(/\$3\.12/)
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    const ptexts = (await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(ptexts).toMatch(/Explorar código/)
    expect(ptexts).toMatch(/haiku-4-5/)
    expect(ptexts).toMatch(/2k tok/)
    expect(ptexts).toMatch(/Bash: npm test/)
    await pane.unmount()
  }

  await clock.advance(65_000)

  // Main loop ends; the background agent keeps the run open.
  await $.turn.complete({ answer: 'listo', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
  let band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await band.findAll({ type: 'Text' })).map(t => t.text).join('\n')).toMatch(/▶/)
  await band.unmount()

  // The agent ends: the run shows its summary.
  await $.turn.complete({ answer: 'ok', durationMs: 10, isAborted: false, turnId: 'ta', agentId: 'a1', reason: 'answer' })
  band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const done = (await band.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(done).toMatch(/✓/)
  expect(done).toMatch(/1 agente/)
  await band.unmount()
})
