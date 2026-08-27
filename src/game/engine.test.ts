import { describe, expect, it } from 'vitest'
import { createGame, emptyCells, hasMoves, move, spawnTile } from './engine'
import type { BoardSize, Core, Tile } from './types'

/**
 * 用数字矩阵构造一个棋盘状态，0 表示空格。
 * 尺寸由矩阵的实际维度推断，因此同一个辅助函数可同时服务 4×4 与 5×5。
 */
function fromMatrix(matrix: number[][], overrides: Partial<Core> = {}): Core {
  const tiles: Tile[] = []
  let nextId = 1
  matrix.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value !== 0) tiles.push({ id: nextId++, row: r, col: c, value })
    }),
  )
  return {
    size: matrix.length as BoardSize,
    tiles,
    score: 0,
    won: false,
    keepPlaying: false,
    over: false,
    nextId,
    ...overrides,
  }
}

/** 把状态还原成矩阵，忽略残影，便于断言 */
function toMatrix(core: Core): number[][] {
  const m = Array.from({ length: core.size }, () =>
    Array.from({ length: core.size }, () => 0),
  )
  for (const t of core.tiles) {
    if (!t.isGhost) m[t.row][t.col] = t.value
  }
  return m
}

/** 固定序列的假随机数，让测试可复现 */
function seededRng(values: number[]) {
  let i = 0
  return () => values[i++ % values.length]
}

/** 让新方块总是落在最后一个空格且值为 2 */
const lastCellRng = seededRng([0.999, 0.0])

describe('move — 基本滑动', () => {
  it('向左把方块挤到最左侧', () => {
    const core = fromMatrix([
      [0, 0, 0, 2],
      [0, 0, 4, 0],
      [0, 8, 0, 0],
      [0, 0, 0, 0],
    ])
    const { core: next, moved } = move(core, 'left', lastCellRng)
    expect(moved).toBe(true)
    const m = toMatrix(next)
    expect(m[0][0]).toBe(2)
    expect(m[1][0]).toBe(4)
    expect(m[2][0]).toBe(8)
  })

  it('向右、向上、向下分别挤到对应边', () => {
    const base = [
      [2, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]
    expect(toMatrix(move(fromMatrix(base), 'right', lastCellRng).core)[0][3]).toBe(2)
    expect(toMatrix(move(fromMatrix(base), 'down', lastCellRng).core)[3][0]).toBe(2)

    const bottom = [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 2],
    ]
    expect(toMatrix(move(fromMatrix(bottom), 'up', lastCellRng).core)[0][3]).toBe(2)
  })

  it('棋盘无变化时不算移动，也不生成新方块', () => {
    const core = fromMatrix([
      [2, 4, 8, 16],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const before = core.tiles.length
    const { moved, core: next } = move(core, 'left', lastCellRng)
    expect(moved).toBe(false)
    expect(next).toBe(core)
    expect(next.tiles.length).toBe(before)
  })
})

describe('move — 合并规则', () => {
  it('相同数字合并并累加分数', () => {
    const core = fromMatrix([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const { core: next, gained } = move(core, 'left', lastCellRng)
    expect(toMatrix(next)[0][0]).toBe(4)
    expect(gained).toBe(4)
    expect(next.score).toBe(4)
  })

  it('一次移动中同一方块不会连续合并两次（2,2,4 → 4,4 而非 8）', () => {
    const core = fromMatrix([
      [2, 2, 4, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const { core: next } = move(core, 'left', lastCellRng)
    const row = toMatrix(next)[0]
    expect(row[0]).toBe(4)
    expect(row[1]).toBe(4)
  })

  it('一行四个相同数字合并成两对，而不是一个', () => {
    const core = fromMatrix([
      [2, 2, 2, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const { core: next, gained } = move(core, 'left', lastCellRng)
    const row = toMatrix(next)[0]
    expect(row[0]).toBe(4)
    expect(row[1]).toBe(4)
    expect(gained).toBe(8)
  })

  it('向右合并时优先靠右的一对（2,2,2 → 2,4）', () => {
    const core = fromMatrix([
      [0, 2, 2, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const { core: next } = move(core, 'right', lastCellRng)
    const row = toMatrix(next)[0]
    expect(row[3]).toBe(4)
    expect(row[2]).toBe(2)
  })

  it('合并后的方块标记 isMerged，被吞掉的方块变成残影停在目标格', () => {
    const core = fromMatrix([
      [2, 0, 0, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const { core: next } = move(core, 'left', lastCellRng)
    const merged = next.tiles.find((t) => t.isMerged)
    const ghost = next.tiles.find((t) => t.isGhost)
    expect(merged?.value).toBe(4)
    expect(ghost).toBeDefined()
    expect(ghost!.row).toBe(merged!.row)
    expect(ghost!.col).toBe(merged!.col)
  })

  it('残影在下一次移动时被清除', () => {
    const core = fromMatrix([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const first = move(core, 'left', lastCellRng).core
    expect(first.tiles.some((t) => t.isGhost)).toBe(true)
    const second = move(first, 'down', lastCellRng).core
    expect(second.tiles.some((t) => t.isGhost)).toBe(false)
  })
})

describe('新方块生成', () => {
  it('开局有两个方块，数值为 2 或 4', () => {
    const core = createGame(4, seededRng([0.1, 0.5, 0.7, 0.95]))
    expect(core.tiles.length).toBe(2)
    for (const t of core.tiles) expect([2, 4]).toContain(t.value)
  })

  it('每次移动后新增一个方块', () => {
    const core = fromMatrix([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    const { core: next } = move(core, 'left', lastCellRng)
    // 原 2 个 → 合并后 1 个 + 1 个残影 + 1 个新生成
    expect(next.tiles.filter((t) => !t.isGhost).length).toBe(2)
    expect(next.tiles.filter((t) => t.isNew).length).toBe(1)
  })

  it('rng < 0.9 出 2，否则出 4', () => {
    const empty = fromMatrix([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    expect(spawnTile(empty, seededRng([0, 0.5])).tiles[0].value).toBe(2)
    expect(spawnTile(empty, seededRng([0, 0.95])).tiles[0].value).toBe(4)
  })

  it('棋盘满时不生成新方块', () => {
    const full = fromMatrix([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
    ])
    expect(emptyCells(full).length).toBe(0)
    expect(spawnTile(full, lastCellRng).tiles.length).toBe(full.size * full.size)
  })
})

describe('胜负判定', () => {
  it('合成 2048 时标记 won', () => {
    const core = fromMatrix([
      [1024, 1024, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ])
    expect(move(core, 'left', lastCellRng).core.won).toBe(true)
  })

  it('满盘且无相邻相同数字时游戏结束', () => {
    // 前三行已满且右移不动；末行 [4,0,2,4] 右移成 [_,4,2,4]，
    // 空格落在 (3,0)，新方块 2 与上方 (2,0) 的 4 不同，于是形成死局
    const stuck = fromMatrix([
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [4, 0, 2, 4],
    ])
    expect(hasMoves(stuck)).toBe(true)
    // rng 全 0 → 落在第一个空格 (3,0) 且值为 2
    const { core: next, moved } = move(stuck, 'right', seededRng([0, 0]))
    expect(moved).toBe(true)
    expect(emptyCells(next).length).toBe(0)
    expect(next.over).toBe(true)
  })

  it('有空格时未结束', () => {
    const core = fromMatrix([
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 0],
    ])
    expect(hasMoves(core)).toBe(true)
  })

  it('满盘但有相邻相同数字时未结束', () => {
    const core = fromMatrix([
      [2, 2, 4, 8],
      [4, 8, 16, 32],
      [8, 16, 32, 64],
      [16, 32, 64, 128],
    ])
    expect(hasMoves(core)).toBe(true)
  })
})

describe('5×5 棋盘', () => {
  it('向左把方块挤过全部 5 列', () => {
    const core = fromMatrix([
      [0, 0, 0, 0, 2],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ])
    expect(core.size).toBe(5)
    const { core: next, moved } = move(core, 'left', lastCellRng)
    expect(moved).toBe(true)
    expect(toMatrix(next)[0][0]).toBe(2)
  })

  it('向下把方块挤到第 5 行', () => {
    const core = fromMatrix([
      [2, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ])
    const { core: next } = move(core, 'down', lastCellRng)
    expect(toMatrix(next)[4][0]).toBe(2)
  })

  it('奇数宽度：一行 5 个相同数字合并成两对加一个余数', () => {
    // 这是 4×4 没有的情形，能暴露奇数宽度下的差一错误
    const core = fromMatrix([
      [2, 2, 2, 2, 2],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ])
    const { core: next, gained } = move(core, 'left', lastCellRng)
    const row = toMatrix(next)[0]
    expect(row[0]).toBe(4)
    expect(row[1]).toBe(4)
    expect(row[2]).toBe(2)
    expect(gained).toBe(8)
  })

  it('向右时 5 个相同数字优先合并靠右的两对', () => {
    const core = fromMatrix([
      [2, 2, 2, 2, 2],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ])
    const { core: next } = move(core, 'right', lastCellRng)
    const row = toMatrix(next)[0]
    expect(row[4]).toBe(4)
    expect(row[3]).toBe(4)
    expect(row[2]).toBe(2)
  })

  it('createGame(5) 得到 5×5 棋盘与两个方块', () => {
    const core = createGame(5, seededRng([0.2, 0.5, 0.8, 0.3]))
    expect(core.size).toBe(5)
    expect(core.tiles.length).toBe(2)
    for (const t of core.tiles) {
      expect(t.row).toBeLessThan(5)
      expect(t.col).toBeLessThan(5)
    }
  })

  it('满盘时空格为 0 且不再生成新方块', () => {
    const full = fromMatrix([
      [2, 4, 2, 4, 2],
      [4, 2, 4, 2, 4],
      [2, 4, 2, 4, 2],
      [4, 2, 4, 2, 4],
      [2, 4, 2, 4, 2],
    ])
    expect(emptyCells(full).length).toBe(0)
    expect(spawnTile(full, lastCellRng).tiles.length).toBe(25)
  })

  it('5×5 也在合成 2048 时判定胜利（目标不随尺寸改变）', () => {
    const core = fromMatrix([
      [1024, 1024, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ])
    const { core: next } = move(core, 'left', lastCellRng)
    expect(next.won).toBe(true)
    expect(toMatrix(next)[0][0]).toBe(2048)
  })

  it('满盘且无相邻相同数字时判定结束', () => {
    // 每行错位排列 5 个互不相同的数字，保证横竖都没有相邻相同项
    const stuck = fromMatrix([
      [2, 4, 8, 16, 32],
      [4, 8, 16, 32, 2],
      [8, 16, 32, 2, 4],
      [16, 32, 2, 4, 8],
      [32, 2, 4, 8, 16],
    ])
    expect(emptyCells(stuck).length).toBe(0)
    expect(hasMoves(stuck)).toBe(false)
  })

  it('满盘但有相邻相同数字时未结束', () => {
    const core = fromMatrix([
      [2, 2, 8, 16, 32],
      [4, 8, 16, 32, 2],
      [8, 16, 32, 2, 4],
      [16, 32, 2, 4, 8],
      [32, 2, 4, 8, 16],
    ])
    expect(hasMoves(core)).toBe(true)
  })

  it('合并后的残影停在目标格，下一回合被清除', () => {
    const core = fromMatrix([
      [2, 0, 0, 0, 2],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ])
    const first = move(core, 'left', lastCellRng).core
    const merged = first.tiles.find((t) => t.isMerged)
    const ghost = first.tiles.find((t) => t.isGhost)
    expect(merged?.value).toBe(4)
    expect(ghost!.row).toBe(merged!.row)
    expect(ghost!.col).toBe(merged!.col)

    const second = move(first, 'down', lastCellRng).core
    expect(second.tiles.some((t) => t.isGhost)).toBe(false)
  })

  it('移动保持 size 不变', () => {
    let core = createGame(5, seededRng([0.4, 0.6, 0.15, 0.85]))
    for (const dir of ['left', 'up', 'right', 'down'] as const) {
      core = move(core, dir, seededRng([0.3, 0.7])).core
      expect(core.size).toBe(5)
    }
  })
})

describe('不变量', () => {
  // 两种尺寸都跑一遍，确保尺寸参数化没有引入坐标越界或重叠
  for (const size of [4, 5] as const) {
    it(`${size}×${size} 随机对局中方块数与分数始终自洽`, () => {
      const rng = seededRng([0.13, 0.42, 0.77, 0.05, 0.91, 0.36, 0.68, 0.24])
      let core = createGame(size, rng)
      const dirs = ['left', 'up', 'right', 'down'] as const
      let expectedScore = 0

      for (let i = 0; i < 200; i++) {
        const { core: next, gained, moved } = move(core, dirs[i % 4], rng)
        if (moved) expectedScore += gained
        core = next
        expect(core.size).toBe(size)
        const alive = core.tiles.filter((t) => !t.isGhost)
        expect(alive.length).toBeLessThanOrEqual(size * size)
        // 坐标不越界，且没有两个活方块占同一格
        const seen = new Set<string>()
        for (const t of alive) {
          expect(t.row).toBeGreaterThanOrEqual(0)
          expect(t.row).toBeLessThan(size)
          expect(t.col).toBeGreaterThanOrEqual(0)
          expect(t.col).toBeLessThan(size)
          const key = `${t.row},${t.col}`
          expect(seen.has(key)).toBe(false)
          seen.add(key)
        }
        expect(core.score).toBe(expectedScore)
        if (core.over) break
      }
    })

    it(`${size}×${size} 所有方块数值都是 2 的幂`, () => {
      const rng = seededRng([0.31, 0.66, 0.08, 0.95, 0.52, 0.19])
      let core = createGame(size, rng)
      const dirs = ['up', 'right', 'down', 'left'] as const
      for (let i = 0; i < 150 && !core.over; i++) {
        core = move(core, dirs[i % 4], rng).core
        for (const t of core.tiles) {
          expect(Number.isInteger(Math.log2(t.value))).toBe(true)
          expect(t.value).toBeGreaterThanOrEqual(2)
        }
      }
    })
  }
})
