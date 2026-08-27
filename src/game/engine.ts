import {
  SIZE,
  WIN_VALUE,
  type Core,
  type Direction,
  type Position,
  type Rng,
  type Tile,
} from './types'

/** 一次移动的结果 */
export interface MoveResult {
  core: Core
  /** 棋盘是否真的发生了变化（未变化则不生成新方块、不计入历史） */
  moved: boolean
  /** 本次移动获得的分数 */
  gained: number
}

const inBounds = (n: number) => n >= 0 && n < SIZE

/**
 * 返回某条「线」上从墙壁向内的格子顺序。
 * 例如向左移动时，第 index 行的格子顺序为 col 0→3，
 * 这样先处理的方块会先靠墙，天然实现了正确的挤压顺序。
 */
function lineCells(dir: Direction, index: number): Position[] {
  const cells: Position[] = []
  for (let i = 0; i < SIZE; i++) {
    switch (dir) {
      case 'left':
        cells.push({ row: index, col: i })
        break
      case 'right':
        cells.push({ row: index, col: SIZE - 1 - i })
        break
      case 'up':
        cells.push({ row: i, col: index })
        break
      case 'down':
        cells.push({ row: SIZE - 1 - i, col: index })
        break
    }
  }
  return cells
}

/** 把方块按坐标放进二维索引，便于 O(1) 查询。忽略 ghost（它们只是残影） */
function toGrid(tiles: Tile[]): (Tile | undefined)[][] {
  const grid: (Tile | undefined)[][] = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => undefined),
  )
  for (const t of tiles) {
    if (!t.isGhost) grid[t.row][t.col] = t
  }
  return grid
}

/** 列出所有空格 */
export function emptyCells(tiles: Tile[]): Position[] {
  const grid = toGrid(tiles)
  const out: Position[] = []
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (!grid[row][col]) out.push({ row, col })
    }
  }
  return out
}

/** 是否还有任何可行的移动（有空格，或存在相邻的相同数字） */
export function hasMoves(tiles: Tile[]): boolean {
  const grid = toGrid(tiles)
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      const t = grid[row][col]
      if (!t) return true
      // 只需向右和向下比较，即可覆盖所有相邻对
      const right = inBounds(col + 1) ? grid[row][col + 1] : undefined
      const down = inBounds(row + 1) ? grid[row + 1][col] : undefined
      if (right?.value === t.value || down?.value === t.value) return true
    }
  }
  return false
}

/** 在随机空格生成一个新方块（90% 出 2，10% 出 4） */
export function spawnTile(core: Core, rng: Rng): Core {
  const empties = emptyCells(core.tiles)
  if (empties.length === 0) return core

  const cell = empties[Math.floor(rng() * empties.length)]
  const tile: Tile = {
    id: core.nextId,
    row: cell.row,
    col: cell.col,
    value: rng() < 0.9 ? 2 : 4,
    isNew: true,
  }
  return { ...core, tiles: [...core.tiles, tile], nextId: core.nextId + 1 }
}

/** 开局：空棋盘 + 两个随机方块 */
export function createGame(rng: Rng = Math.random): Core {
  const empty: Core = {
    tiles: [],
    score: 0,
    won: false,
    keepPlaying: false,
    over: false,
    nextId: 1,
  }
  return spawnTile(spawnTile(empty, rng), rng)
}

/**
 * 执行一次移动。
 *
 * 动画策略：合并时保留「被撞上」的那个方块的 id 并把它翻倍（播放弹出动画），
 * 撞过去的方块滑到同一格后标记为 ghost，在下一回合开始时被清除。
 * 这样两个方块都有真实的位移过渡，视觉上就是「滑过去然后合并」。
 */
export function move(core: Core, dir: Direction, rng: Rng = Math.random): MoveResult {
  // 清理上一回合的动画标记与残影
  const live: Tile[] = core.tiles
    .filter((t) => !t.isGhost)
    .map((t) => ({ id: t.id, row: t.row, col: t.col, value: t.value }))

  const grid = toGrid(live)
  const survivors: Tile[] = []
  const ghosts: Tile[] = []
  let gained = 0
  let moved = false

  for (let index = 0; index < SIZE; index++) {
    const cells = lineCells(dir, index)
    const lineTiles = cells
      .map(({ row, col }) => grid[row][col])
      .filter((t): t is Tile => t !== undefined)

    let cursor = 0
    // 该线上最近一个已落位的方块，以及它是否已经参与过合并
    let last: Tile | undefined
    let lastMerged = false

    for (const tile of lineTiles) {
      if (last && !lastMerged && last.value === tile.value) {
        // 合并：last 翻倍留在原地，撞上去的 tile 滑到同一格后变成残影
        last.value *= 2
        last.isMerged = true
        lastMerged = true
        gained += last.value
        ghosts.push({ ...tile, row: last.row, col: last.col, isGhost: true })
        moved = true
      } else {
        const dest = cells[cursor++]
        if (tile.row !== dest.row || tile.col !== dest.col) {
          tile.row = dest.row
          tile.col = dest.col
          moved = true
        }
        survivors.push(tile)
        last = tile
        lastMerged = false
      }
    }
  }

  if (!moved) return { core, moved: false, gained: 0 }

  // ghost 放在前面，让新的合并方块渲染在其上方
  let next: Core = {
    ...core,
    tiles: [...ghosts, ...survivors],
    score: core.score + gained,
  }
  next = spawnTile(next, rng)

  const reachedWin = survivors.some((t) => t.value >= WIN_VALUE)
  next.won = core.won || reachedWin
  next.over = !hasMoves(next.tiles)

  return { core: next, moved: true, gained }
}
