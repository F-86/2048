/** 棋盘边长（4x4） */
export const SIZE = 4

/** 达成即算胜利的目标数字 */
export const WIN_VALUE = 2048

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
}

/** 随机数发生器，注入以便测试可复现 */
export type Rng = () => number
