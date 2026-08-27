import { useCallback, useEffect, useMemo, useReducer } from 'react'
import { createGame, move as applyMove } from './engine'
import type { Core, Direction, Rng } from './types'

const STORAGE_KEY = 'react-2048/state-v1'
const BEST_KEY = 'react-2048/best-v1'
/** 撤销栈上限，避免存档无限增长 */
const MAX_HISTORY = 20

interface GameState {
  core: Core
  /** 撤销栈，只存核心状态 */
  history: Core[]
  best: number
  /** 最近一次得分增量，用于分数上方的 "+4" 飘字 */
  gain: { value: number; key: number } | null
  /** 飘字的自增序号，用于强制重播动画 */
  gainSeq: number
}

type Action =
  /** rand 由调用方预先取好，保证 reducer 是纯函数 */
  | { type: 'move'; dir: Direction; rand: number[] }
  | { type: 'undo' }
  | { type: 'restart'; core: Core }
  | { type: 'keepPlaying' }

/** 用预先取好的随机数序列构造 rng，让 reducer 可预测、可重放 */
function seqRng(values: number[]): Rng {
  let i = 0
  return () => values[i++ % values.length]
}

function reducer(state: GameState, action: Action): GameState {
  switch (action.type) {
    case 'move': {
      const { core } = state
      if (core.over) return state
      // 达成 2048 且尚未选择「继续挑战」时暂停移动
      if (core.won && !core.keepPlaying) return state

      const { core: next, moved, gained } = applyMove(core, action.dir, seqRng(action.rand))
      if (!moved) return state

      const gainSeq = gained > 0 ? state.gainSeq + 1 : state.gainSeq
      return {
        ...state,
        core: next,
        history: [...state.history, core].slice(-MAX_HISTORY),
        best: Math.max(state.best, next.score),
        gain: gained > 0 ? { value: gained, key: gainSeq } : null,
        gainSeq,
      }
    }

    case 'undo': {
      const prev = state.history[state.history.length - 1]
      if (!prev) return state
      // best 不随撤销回退，保留历史最高分
      return { ...state, core: prev, history: state.history.slice(0, -1), gain: null }
    }

    case 'restart':
      return { ...state, core: action.core, history: [], gain: null }

    case 'keepPlaying':
      return { ...state, core: { ...state.core, keepPlaying: true } }
  }
}

function loadBest(): number {
  try {
    const raw = localStorage.getItem(BEST_KEY)
    const n = raw === null ? 0 : Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : 0
  } catch {
    return 0
  }
}

/** 读取存档；数据缺失或损坏时回退到新对局 */
function loadInitial(): GameState {
  const best = loadBest()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { core?: Core; history?: Core[] }
      const core = parsed.core
      if (core && Array.isArray(core.tiles) && typeof core.score === 'number') {
        return {
          core,
          history: Array.isArray(parsed.history) ? parsed.history : [],
          best: Math.max(best, core.score),
          gain: null,
          gainSeq: 0,
        }
      }
    }
  } catch {
    // 忽略损坏的存档
  }
  return { core: createGame(), history: [], best, gain: null, gainSeq: 0 }
}

export function useGame() {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial)
  const { core, history, best, gain } = state

  // 持久化对局
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ core, history }))
    } catch {
      // 隐私模式下 localStorage 可能不可写，忽略
    }
  }, [core, history])

  // 持久化最高分
  useEffect(() => {
    try {
      localStorage.setItem(BEST_KEY, String(best))
    } catch {
      // 同上
    }
  }, [best])

  const move = useCallback((dir: Direction) => {
    // 随机数在 reducer 外取，reducer 保持纯函数（StrictMode 重复执行结果一致）
    dispatch({ type: 'move', dir, rand: [Math.random(), Math.random()] })
  }, [])

  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const restart = useCallback(() => dispatch({ type: 'restart', core: createGame() }), [])
  const keepPlaying = useCallback(() => dispatch({ type: 'keepPlaying' }), [])

  const canUndo = history.length > 0

  return useMemo(
    () => ({ core, best, gain, canUndo, move, undo, restart, keepPlaying }),
    [core, best, gain, canUndo, move, undo, restart, keepPlaying],
  )
}
