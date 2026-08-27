import {
  WIN_VALUE,
  type BoardSize,
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
  /** 本次移动实际获得的分数（已乘上连锁与连击倍率并取整） */
  gained: number
  /** 未乘倍率前的合并值之和 */
  base: number
  /** 本次移动合并了多少对 */
  mergeCount: number
  /** 本次生效的总倍率 */
  multiplier: number
}

/**
 * 连锁 × 连击倍率。
 *
 * 一次移动合并的对数越多倍率越高（连锁），连续多步都有合并再叠一层加成（连击）。
 * 这让「憋一手大合并」比零散合并更值，玩家因此有了主动构筑的动机。
 *
 * @param mergeCount 本次移动合并的对数
 * @param streak 连续有合并的移动数，含本次
 */
export function comboMultiplier(mergeCount: number, streak: number): number {
  // 没有合并就不该有倍率，更不能让下面的减一算出小于 1 的「惩罚」
  if (mergeCount <= 0) return 1
  // 1 对 = 1.0，2 对 = 1.5，3 对 = 2.0，4 对 = 2.5
  const chain = 1 + 0.5 * (mergeCount - 1)
  // 连击从第 2 步起每步 +10%，封顶 +50%
  const streakBonus = 1 + 0.1 * Math.min(Math.max(streak - 1, 0), 5)
  return chain * streakBonus
}

const inBounds = (n: number, size: number) => n >= 0 && n < size

/**
 * 返回某条「线」上从墙壁向内的格子顺序。
 * 例如向左移动时，第 index 行的格子顺序为 col 0→size-1，
 * 这样先处理的方块会先靠墙，天然实现了正确的挤压顺序。
 */
function lineCells(dir: Direction, index: number, size: number): Position[] {
  const cells: Position[] = []
  for (let i = 0; i < size; i++) {
    switch (dir) {
      case 'left':
        cells.push({ row: index, col: i })
        break
      case 'right':
        cells.push({ row: index, col: size - 1 - i })
        break
      case 'up':
        cells.push({ row: i, col: index })
        break
      case 'down':
        cells.push({ row: size - 1 - i, col: index })
        break
    }
  }
  return cells
}

/** 把方块按坐标放进二维索引，便于 O(1) 查询。忽略 ghost（它们只是残影） */
function toGrid(tiles: Tile[], size: number): (Tile | undefined)[][] {
  const grid: (Tile | undefined)[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => undefined),
  )
  for (const t of tiles) {
    if (!t.isGhost) grid[t.row][t.col] = t
  }
  return grid
}

/** 列出所有空格 */
export function emptyCells(core: Core): Position[] {
  const { size } = core
  const grid = toGrid(core.tiles, size)
  const out: Position[] = []
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!grid[row][col]) out.push({ row, col })
    }
  }
  return out
}

/** 是否还有任何可行的移动（有空格，或存在相邻的相同数字） */
export function hasMoves(core: Core): boolean {
  const { size } = core
  const grid = toGrid(core.tiles, size)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const t = grid[row][col]
      if (!t) return true
      // 只需向右和向下比较，即可覆盖所有相邻对
      const right = inBounds(col + 1, size) ? grid[row][col + 1] : undefined
      const down = inBounds(row + 1, size) ? grid[row + 1][col] : undefined
      if (right?.value === t.value || down?.value === t.value) return true
    }
  }
  return false
}

/** 掷出下一个方块的数值（90% 出 2，10% 出 4） */
function rollNext(rng: Rng): number {
  return rng() < 0.9 ? 2 : 4
}

/**
 * 在随机空格生成一个新方块。
 *
 * 数值取 `core.next`（即 UI 上预告的那个），落子后再掷出新的预告值。
 * rng 的调用次数与顺序保持为「先位置、后数值」，与预告功能引入前一致。
 */
export function spawnTile(core: Core, rng: Rng): Core {
  const empties = emptyCells(core)
  // 满盘时不落子，也不消耗预告值——否则预告的数字永远不会出现，等于说谎
  if (empties.length === 0) return core

  const cell = empties[Math.floor(rng() * empties.length)]
  const tile: Tile = {
    id: core.nextId,
    row: cell.row,
    col: cell.col,
    value: core.next,
    isNew: true,
  }
  return {
    ...core,
    tiles: [...core.tiles, tile],
    nextId: core.nextId + 1,
    next: rollNext(rng),
  }
}

/** 开局：空棋盘 + 两个随机方块 */
export function createGame(size: BoardSize, rng: Rng = Math.random): Core {
  const empty: Core = {
    size,
    tiles: [],
    score: 0,
    won: false,
    keepPlaying: false,
    over: false,
    nextId: 1,
    // 用常量而非掷骰，以免多消耗一次 rng 打乱既有的随机序列
    next: 2,
    streak: 0,
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
  const { size } = core

  // 清理上一回合的动画标记与残影
  const live: Tile[] = core.tiles
    .filter((t) => !t.isGhost)
    .map((t) => ({ id: t.id, row: t.row, col: t.col, value: t.value }))

  const grid = toGrid(live, size)
  const survivors: Tile[] = []
  const ghosts: Tile[] = []
  let base = 0
  let moved = false

  for (let index = 0; index < size; index++) {
    const cells = lineCells(dir, index, size)
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
        base += last.value
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

  // 无效移动原样返回：既不落子也不断连击，玩家撞墙不该受罚
  if (!moved) return { core, moved: false, gained: 0, base: 0, mergeCount: 0, multiplier: 1 }

  // 每次合并恰好产生一个残影，因此 ghost 数就是合并对数
  const mergeCount = ghosts.length
  const streak = mergeCount > 0 ? core.streak + 1 : 0
  const multiplier = comboMultiplier(mergeCount, streak)
  const gained = Math.round(base * multiplier)

  // ghost 放在前面，让新的合并方块渲染在其上方
  let next: Core = {
    ...core,
    tiles: [...ghosts, ...survivors],
    score: core.score + gained,
    streak,
  }
  next = spawnTile(next, rng)

  const reachedWin = survivors.some((t) => t.value >= WIN_VALUE)
  next.won = core.won || reachedWin
  next.over = !hasMoves(next)

  return { core: next, moved: true, gained, base, mergeCount, multiplier }
}
