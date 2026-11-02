export type TaskStatus = 'pending' | 'in_progress' | 'completed'

/** One item of a task list (TaskCreate/TaskUpdate or TodoWrite). */
export type TaskItem = {
  id: string
  subject: string
  status: TaskStatus
  /** The loop that owns it: 'main' or a subagent's id. */
  loop: string
  /** Counted in the current run's progress. */
  inRun: boolean
}

export type AgentRow = {
  id: string
  parentId?: string
  description: string
  type: string
  model: string
  isBackground: boolean
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
  steps: number
  tokens: number
  lastTool?: string
}

export type Run = {
  startedAt: number
  /** When the main loop's turn ended; undefined while it runs. */
  mainEndedAt?: number
  /** When the whole run ended (main + every agent); undefined while active. */
  endedAt?: number
  steps: number
  tokens: number
  lastTool?: string
}

export type Usage = {
  fiveHour?: { percent: number; resetsAt?: string }
  sevenDay?: { percent: number; resetsAt?: string }
  contextPercent?: number
  costUsd?: number
}

declare module 'claude-code' {
  interface PluginState {
    'task-stats': {
      run: Shaped<Run | null>
      agents: Shaped<AgentRow[]>
      tasks: Shaped<TaskItem[]>
      usage: Shaped<Usage>
      warnedReset: string | null
    }
  }
}
