/**
 * 存档读写。
 *
 * 两种棋盘尺寸各自独立存档，互不干扰；键名带尺寸后缀。
 * 全部是纯函数（只依赖 localStorage），便于独立测试。
 */

import { BOARD_SIZES, DEFAULT_SIZE, type BoardSize, type Core } from './types'

/** v1 时期的旧键（仅 4×4），用于一次性迁移 */
const V1_STATE_KEY = 'react-2048/state-v1'
const V1_BEST_KEY = 'react-2048/best-v1'

/** 最后使用的尺寸 */
const SIZE_KEY = 'react-2048/size-v1'

const stateKey = (size: BoardSize) => `react-2048/state-v2-${size}x${size}`
const bestKey = (size: BoardSize) => `react-2048/best-v2-${size}x${size}`

/** 一份存档的内容 */
export interface Saved {
  core: Core
  /** 撤销栈 */
  history: Core[]
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // 隐私模式下可能不可读
    return null
  }
}

function writeRaw(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 隐私模式下可能不可写，忽略
  }
}

/**
 * 校验一份 core 是否是合法的、且确实属于指定尺寸的棋盘。
 * 尺寸不符或坐标越界都必须拒绝——否则下一步移动会在建立网格索引时越界。
 */
export function isValidCore(value: unknown, size: BoardSize): value is Core {
  if (!value || typeof value !== 'object') return false
  const core = value as Partial<Core>

  if (core.size !== size) return false
  if (typeof core.score !== 'number' || !Number.isFinite(core.score)) return false
  if (typeof core.nextId !== 'number' || !Number.isFinite(core.nextId)) return false
  if (!Array.isArray(core.tiles)) return false

  for (const tile of core.tiles) {
    if (!tile || typeof tile !== 'object') return false
    const { row, col, value: v, id } = tile
    if (!Number.isInteger(row) || row < 0 || row >= size) return false
    if (!Number.isInteger(col) || col < 0 || col >= size) return false
    if (!Number.isInteger(id)) return false
    if (typeof v !== 'number' || v < 2) return false
  }
  return true
}

/**
 * 读取指定尺寸的存档。
 * 4×4 在新键缺失时会回退读取 v1 旧存档（补上 size 字段），避免升级后丢失进度。
 */
export function loadSaved(size: BoardSize): Saved | null {
  const raw = readRaw(stateKey(size))
  if (raw) {
    const parsed = parseSaved(raw, size)
    if (parsed) return parsed
  }

  // 迁移：v1 存档没有 size 字段，且只可能是 4×4
  if (size === 4) {
    const legacy = readRaw(V1_STATE_KEY)
    if (legacy) return parseSaved(legacy, 4, true)
  }
  return null
}

/**
 * 解析存档 JSON。
 * @param addSize 为 true 时给缺少 size 的旧数据补上（v1 迁移路径）
 */
function parseSaved(raw: string, size: BoardSize, addSize = false): Saved | null {
  try {
    const parsed = JSON.parse(raw) as { core?: unknown; history?: unknown }
    let core = parsed.core

    if (addSize && core && typeof core === 'object' && !('size' in core)) {
      core = { ...(core as object), size }
    }
    if (!isValidCore(core, size)) return null

    // 撤销栈里只要有一项不合法就整个丢弃：跨尺寸的历史会让 undo 产出坏状态
    let history: Core[] = []
    if (Array.isArray(parsed.history)) {
      const entries = addSize
        ? parsed.history.map((h) =>
            h && typeof h === 'object' && !('size' in h) ? { ...(h as object), size } : h,
          )
        : parsed.history
      history = entries.every((h) => isValidCore(h, size)) ? (entries as Core[]) : []
    }

    return { core, history }
  } catch {
    // 损坏的 JSON
    return null
  }
}

/** 写入指定尺寸的存档 */
export function saveGame(size: BoardSize, saved: Saved) {
  writeRaw(stateKey(size), JSON.stringify(saved))
}

/** 读取指定尺寸的最高分；4×4 在新键缺失时迁移 v1 */
export function loadBest(size: BoardSize): number {
  const parse = (raw: string | null) => {
    if (raw === null) return null
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  const current = parse(readRaw(bestKey(size)))
  if (current !== null) return current

  if (size === 4) {
    const legacy = parse(readRaw(V1_BEST_KEY))
    if (legacy !== null) return legacy
  }
  return 0
}

/** 写入指定尺寸的最高分 */
export function saveBest(size: BoardSize, best: number) {
  writeRaw(bestKey(size), String(best))
}

/** 读取最后使用的尺寸，非法值回退到默认尺寸 */
export function loadSize(): BoardSize {
  const raw = readRaw(SIZE_KEY)
  const n = Number(raw)
  return BOARD_SIZES.includes(n as BoardSize) ? (n as BoardSize) : DEFAULT_SIZE
}

/** 记住当前使用的尺寸 */
export function saveSize(size: BoardSize) {
  writeRaw(SIZE_KEY, String(size))
}
