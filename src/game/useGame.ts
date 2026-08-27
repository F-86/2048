import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createGame, move as applyMove } from './engine'
import { applyMuted, loadMuted, saveMuted, sfx } from './sfx'
import type { Core, Direction, Rng } from './types'

const STORAGE_KEY = 'react-2048/state-v1'
const BEST_KEY = 'react-2048/best-v1'
/** 撤销栈上限，避免存档无限增长 */
const MAX_HISTORY = 20

/**
 * 待播放的音效描述。
 * reducer 只负责「描述该播什么」，实际播放交给 effect，从而保持 reducer 纯净。
 * seq 用于让连续两次相同音效也能触发 effect。
 */
type SoundEvent =
  | { kind: 'move'; seq: number }
  /** value 为本次合成出的最大数字，用于决定音高 */
  | { kind: 'merge'; value: number; seq: number }
  | { kind: 'undo'; seq: number }
  | { kind: 'restart'; seq: number }

interface GameState {
  core: Core
  /** 撤销栈，只存核心状态 */
  history: Core[]
  best: number
  /** 最近一次得分增量，用于分数上方的 "+4" 飘字 */
  gain: { value: number; key: number } | null
  /** 飘字的自增序号，用于强制重播动画 */
  gainSeq: number
  /** 待播放的音效，由 useGame 的 effect 消费 */
  sound: SoundEvent | null
  /** 音效序号，保证同类音效连续触发时 effect 仍会重跑 */
  soundSeq: number
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
      const soundSeq = state.soundSeq + 1
      // 有合并就播合并音（音高取本次最大的合成数字），否则播滑动音
      const mergedValues = next.tiles.filter((t) => t.isMerged).map((t) => t.value)
      const sound: SoundEvent = mergedValues.length
        ? { kind: 'merge', value: Math.max(...mergedValues), seq: soundSeq }
        : { kind: 'move', seq: soundSeq }

      return {
        ...state,
        core: next,
        history: [...state.history, core].slice(-MAX_HISTORY),
        best: Math.max(state.best, next.score),
        gain: gained > 0 ? { value: gained, key: gainSeq } : null,
        gainSeq,
        sound,
        soundSeq,
      }
    }

    case 'undo': {
      const prev = state.history[state.history.length - 1]
      if (!prev) return state
      const soundSeq = state.soundSeq + 1
      // best 不随撤销回退，保留历史最高分
      return {
        ...state,
        core: prev,
        history: state.history.slice(0, -1),
        gain: null,
        sound: { kind: 'undo', seq: soundSeq },
        soundSeq,
      }
    }

    case 'restart': {
      const soundSeq = state.soundSeq + 1
      return {
        ...state,
        core: action.core,
        history: [],
        gain: null,
        sound: { kind: 'restart', seq: soundSeq },
        soundSeq,
      }
    }

    case 'keepPlaying':
      return { ...state, core: { ...state.core, keepPlaying: true }, sound: null }
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
  const base = { gain: null, gainSeq: 0, sound: null, soundSeq: 0 }
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
          ...base,
        }
      }
    }
  } catch {
    // 忽略损坏的存档
  }
  return { core: createGame(), history: [], best, ...base }
}

export function useGame() {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial)
  const { core, history, best, gain, sound } = state

  const [muted, setMuted] = useState(loadMuted)

  // 静音偏好变化时同步到音频与存储
  useEffect(() => {
    applyMuted(muted)
    saveMuted(muted)
  }, [muted])

  // 播放 move / merge / undo / restart 音效
  useEffect(() => {
    if (!sound) return
    switch (sound.kind) {
      case 'move':
        sfx.move()
        break
      case 'merge':
        sfx.merge(sound.value)
        break
      case 'undo':
        sfx.undo()
        break
      case 'restart':
        sfx.restart()
        break
    }
  }, [sound])

  // 胜负音效只在状态首次翻转时播放一次
  const prevWon = useRef(core.won)
  const prevOver = useRef(core.over)
  useEffect(() => {
    if (core.won && !prevWon.current) sfx.win()
    if (core.over && !prevOver.current) sfx.over()
    prevWon.current = core.won
    prevOver.current = core.over
  }, [core.won, core.over])

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
  const toggleMute = useCallback(() => setMuted((m) => !m), [])

  const canUndo = history.length > 0

  return useMemo(
    () => ({
      core,
      best,
      gain,
      canUndo,
      muted,
      move,
      undo,
      restart,
      keepPlaying,
      toggleMute,
    }),
    [core, best, gain, canUndo, muted, move, undo, restart, keepPlaying, toggleMute],
  )
}
