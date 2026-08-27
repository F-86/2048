import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { createGame, emptyCells, move as applyMove } from './engine'
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
import { DANGER_CELLS, UNDO_COST, type BoardSize, type Core, type Direction, type Rng } from './types'

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
  /** count 为本次合并的对数，用于决定琶音长度 */
  | { kind: 'combo'; value: number; count: number; seq: number }
  | { kind: 'undo'; seq: number }
  | { kind: 'restart'; seq: number }

/**
 * 一局之内累计的统计，用于结束时的复盘。
 *
 * 这些数字描述「玩家实际做过什么」，因此**不随撤销回退**——所以它们放在
 * GameState 而不是 Core 里（Core 会被整体快照进撤销栈）。
 */
export interface RunStats {
  /** 有效移动步数 */
  moves: number
  /** 累计合并对数 */
  merges: number
  /** 本局达到过的最长连击 */
  bestStreak: number
  /** 撤销次数 */
  undos: number
}

const EMPTY_STATS: RunStats = { moves: 0, merges: 0, bestStreak: 0, undos: 0 }

interface GameState {
  core: Core
  /** 撤销栈，只存核心状态 */
  history: Core[]
  best: number
  /**
   * 本局开始时的最高分。
   * 因为 best 会随分数实时抬升，破纪录判定与复盘必须拿这个基准比，否则永远相等。
   */
  bestAtRunStart: number
  stats: RunStats
  /** 最近一次得分变化，用于分数上方的飘字；负值表示撤销扣分 */
  gain: { value: number; multiplier: number; key: number } | null
  /** 飘字的自增序号，用于强制重播动画 */
  gainSeq: number
  /** 待播放的音效，由 useGame 的 effect 消费 */
  sound: SoundEvent | null
  /** 音效序号，保证同类音效连续触发时 effect 仍会重跑 */
  soundSeq: number
  /** 连锁震动的序号：值一变就重播震动动画 */
  shakeSeq: number
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

      const result = applyMove(core, action.dir, seqRng(action.rand))
      const { core: next, moved, gained, mergeCount, multiplier } = result
      if (!moved) return state

      const gainSeq = gained > 0 ? state.gainSeq + 1 : state.gainSeq
      const soundSeq = state.soundSeq + 1
      // 多对连锁播琶音，单对播原来的合并音，没合并则播滑动音
      const mergedValues = next.tiles.filter((t) => t.isMerged).map((t) => t.value)
      const topValue = mergedValues.length ? Math.max(...mergedValues) : 0
      const sound: SoundEvent =
        mergeCount > 1
          ? { kind: 'combo', value: topValue, count: mergeCount, seq: soundSeq }
          : mergeCount === 1
            ? { kind: 'merge', value: topValue, seq: soundSeq }
            : { kind: 'move', seq: soundSeq }

      return {
        ...state,
        core: next,
        history: [...state.history, core].slice(-MAX_HISTORY),
        best: Math.max(state.best, next.score),
        stats: {
          moves: state.stats.moves + 1,
          merges: state.stats.merges + mergeCount,
          bestStreak: Math.max(state.stats.bestStreak, next.streak),
          undos: state.stats.undos,
        },
        gain: gained > 0 ? { value: gained, multiplier, key: gainSeq } : null,
        gainSeq,
        sound,
        soundSeq,
        // 两对以上才震，避免每步都晃
        shakeSeq: mergeCount > 1 ? state.shakeSeq + 1 : state.shakeSeq,
      }
    }

    case 'undo': {
      const prev = state.history[state.history.length - 1]
      if (!prev) return state
      // 必须在 reducer 内独立复查，不能只靠按钮的 disabled：
      // Z 键走的是另一条路径，会绕过 UI 的限制
      if (prev.score < UNDO_COST) return state

      const soundSeq = state.soundSeq + 1
      const gainSeq = state.gainSeq + 1
      // best 不随撤销回退，保留历史最高分
      return {
        ...state,
        core: { ...prev, score: prev.score - UNDO_COST },
        history: state.history.slice(0, -1),
        stats: { ...state.stats, undos: state.stats.undos + 1 },
        gain: { value: -UNDO_COST, multiplier: 1, key: gainSeq },
        gainSeq,
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
        // 新的一局重新以当前最高分为基准
        bestAtRunStart: state.best,
        stats: EMPTY_STATS,
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
        bestAtRunStart: action.best,
        stats: EMPTY_STATS,
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
  const size = loadSize()
  // 必须取存储里的原始最高分作为基准：loadForSize 返回的 best 已被当前分数抬高过，
  // 用它当基准会让「破纪录」永远无法成立
  const bestAtRunStart = loadBest(size)
  const { core, history, best } = loadForSize(size)
  return {
    core,
    history,
    best,
    bestAtRunStart,
    stats: EMPTY_STATS,
    gain: null,
    gainSeq: 0,
    sound: null,
    soundSeq: 0,
    shakeSeq: 0,
  }
}

export function useGame() {
  const [state, dispatch] = useReducer(reducer, undefined, loadInitial)
  const { core, history, best, bestAtRunStart, stats, gain, sound, shakeSeq } = state
  const size = core.size

  const [muted, setMuted] = useState(loadMuted)

  // 空格数少于阈值即为危险。必须用 emptyCells 而不是 tiles.length：
  // 合并后残影与合并块同占一格，按数组长度会高估占用
  const danger = emptyCells(core).length <= DANGER_CELLS && !core.over
  // 破纪录只在本局真的超过「开局时的最高分」时成立；全新存档（基准为 0）不算
  const beatRecord = bestAtRunStart > 0 && core.score > bestAtRunStart

  // 静音偏好变化时同步到音频与存储
  useEffect(() => {
    applyMuted(muted)
    saveMuted(muted)
  }, [muted])

  // 播放 move / merge / combo / undo / restart 音效
  useEffect(() => {
    if (!sound) return
    switch (sound.kind) {
      case 'move':
        sfx.move()
        break
      case 'merge':
        sfx.merge(sound.value)
        break
      case 'combo':
        sfx.combo(sound.value, sound.count)
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

  /*
   * 危险与破纪录用边沿检测，而不是塞进 reducer 的 sound 槽：
   * 那是单槽的，一次移动可能同时「合并 + 进危险 + 破纪录」，挤在一起必然丢事件。
   * ref 用载入时的值初始化，这样读档进入一个本就危险的局面不会在页面加载时就响。
   */
  const prevDanger = useRef(danger)
  useEffect(() => {
    if (danger && !prevDanger.current) sfx.danger()
    prevDanger.current = danger
  }, [danger])

  const prevRecord = useRef(beatRecord)
  useEffect(() => {
    if (beatRecord && !prevRecord.current) sfx.record()
    prevRecord.current = beatRecord
  }, [beatRecord])

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

  /** 撤销要花分：栈非空还不够，扣完不能变负数 */
  const undoCandidate = history[history.length - 1]
  const canUndo = undoCandidate !== undefined && undoCandidate.score >= UNDO_COST

  /** 本局最大的方块（忽略残影）。空棋盘时返回 0，避免 Math.max(...[]) 得到 -Infinity */
  const maxTile = core.tiles.reduce((m, t) => (t.isGhost || t.value <= m ? m : t.value), 0)

  return useMemo(
    () => ({
      core,
      size,
      best,
      gain,
      canUndo,
      muted,
      danger,
      beatRecord,
      stats,
      maxTile,
      shakeSeq,
      nextTile: core.next,
      undoCost: UNDO_COST,
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
      danger,
      beatRecord,
      stats,
      maxTile,
      shakeSeq,
      move,
      undo,
      restart,
      keepPlaying,
      toggleMute,
      setSize,
    ],
  )
}
