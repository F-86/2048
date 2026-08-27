/** 支持的棋盘边长 */
export type BoardSize = 4 | 5

/** 可选的棋盘尺寸，顺序即 UI 上的展示顺序 */
export const BOARD_SIZES: readonly BoardSize[] = [4, 5]

/** 默认棋盘尺寸（经典 2048） */
export const DEFAULT_SIZE: BoardSize = 4

/** 达成即算胜利的目标数字，两种尺寸共用 */
export const WIN_VALUE = 2048

/** 撤销一步的分数代价：让每个决策重新有重量 */
export const UNDO_COST = 500

/** 空格数少于等于该值时进入「危险」状态（泛红 + 心跳） */
export const DANGER_CELLS = 2

export type Direction = 'up' | 'down' | 'left' | 'right'

export interface Position {
  row: number
  col: number
}

export interface Tile extends Position {
  /** 稳定 id：React 靠它复用 DOM 节点，从而让位移产生 CSS 过渡动画 */
  id: number
  value: number
  /** 由合并产生的新方块，播放「弹出」动画 */
  isMerged?: boolean
  /** 本回合随机生成的方块，播放「出现」动画 */
  isNew?: boolean
  /** 合并后即将消失的源方块：先滑到目标格，下一回合被清除 */
  isGhost?: boolean
}

/** 游戏核心状态（不含 best / 撤销历史等外围数据） */
export interface Core {
  /** 棋盘边长，随对局持久化，用于校验存档与目标尺寸是否匹配 */
  size: BoardSize
  tiles: Tile[]
  score: number
  /** 是否曾达成 2048 */
  won: boolean
  /** 达成 2048 后玩家选择继续 */
  keepPlaying: boolean
  /** 无路可走 */
  over: boolean
  /** 下一个可用的方块 id */
  nextId: number
  /** 下一个将要生成的方块数值（2 或 4），提前决定以便 UI 预告 */
  next: number
  /** 连续有合并的移动数，用于连击加成；走出一步没有合并就归零 */
  streak: number
}

/** 随机数发生器，注入以便测试可复现 */
export type Rng = () => number
