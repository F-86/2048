import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createGame, move as applyMove } from './engine'
import { applyMuted, loadMuted, saveMuted, sfx } from './sfx'
import {
  loadBest,
  loadSaved,
  loadSize,
  saveBest,
  saveGame,
  saveSize,
  type Saved,
} from './storage'
import type { BoardSize, Core, Direction, Rng } from './types'

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
  /**
   * 切换棋盘尺寸。存档与最高分由调用方在 dispatch 前读好传入，
   * 以保持 reducer 纯净（与 rand 的处理方式一致）。
   */
  | { type: 'setSize'; core: Core; history: Core[]; best: number }

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

    case 'setSize': {
      const soundSeq = state.soundSeq + 1
      // 整体换成目标尺寸的存档：撤销栈绝不能跨尺寸，
      // 否则 undo 出来的 core 会与 tiles 尺寸不符
      return {
        ...state,
        core: action.core,
        history: action.history,
        best: action.best,
        gain: null,
        sound: { kind: 'restart', seq: soundSeq },
        soundSeq,
      }
    }

    case 'keepPlaying':
      return { ...state, core: { ...state.core, keepPlaying: true }, sound: null }
  }
}

/** 读取指定尺寸的存档，缺失或损坏时开新局 */
function loadForSize(size: BoardSize): { core: Core; history: Core[]; best: number } {
  const saved: Saved | null = loadSaved(size)
  const best = loadBest(size)
  if (saved) {
    return {
      core: saved.core,
      history: saved.history,
      best: Math.max(best, saved.core.score),
    }
  }
  return { core: createGame(size), history: [], best }
}

/** 惰性初始化：按最后使用的尺寸载入 */
function loadInitial(): GameState {
  const { core, history, best } = loadForSize(loadSize())
  return { core, history, best, gain: null, gainSeq: 0, sound: null, soundSeq: 0 }
}

export function useGame() {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial)
  const { core, history, best, gain, sound } = state
  const size = core.size

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

  // 持久化对局（按尺寸分别存）
  useEffect(() => {
    saveGame(size, { core, history })
  }, [size, core, history])

  // 持久化最高分（按尺寸分别存）
  useEffect(() => {
    saveBest(size, best)
  }, [size, best])

  // 记住最后使用的尺寸，刷新后恢复
  useEffect(() => {
    saveSize(size)
  }, [size])

  // 供 restart / setSize 读取当前尺寸，避免把 size 放进依赖导致回调频繁重建
  const sizeRef = useRef(size)
  sizeRef.current = size

  const move = useCallback((dir: Direction) => {
    // 随机数在 reducer 外取，reducer 保持纯函数（StrictMode 重复执行结果一致）
    dispatch({ type: 'move', dir, rand: [Math.random(), Math.random()] })
  }, [])

  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const keepPlaying = useCallback(() => dispatch({ type: 'keepPlaying' }), [])
  const toggleMute = useCallback(() => setMuted((m) => !m), [])

  const restart = useCallback(() => {
    dispatch({ type: 'restart', core: createGame(sizeRef.current) })
  }, [])

  /**
   * 切换棋盘尺寸：载入目标尺寸自己的存档，接着上次那局继续。
   * 读存档这一步在 dispatch 之前完成，reducer 保持纯净。
   */
  const setSize = useCallback((next: BoardSize) => {
    if (next === sizeRef.current) return
    const loaded = loadForSize(next)
    dispatch({ type: 'setSize', ...loaded })
  }, [])

  const canUndo = history.length > 0

  return useMemo(
    () => ({
      core,
      size,
      best,
      gain,
      canUndo,
      muted,
      move,
      undo,
      restart,
      keepPlaying,
      toggleMute,
      setSize,
    }),
    [
      core,
      size,
      best,
      gain,
      canUndo,
      muted,
      move,
      undo,
      restart,
      keepPlaying,
      toggleMute,
      setSize,
    ],
  )
}
