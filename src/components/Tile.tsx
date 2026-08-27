import { SIZE, type Tile as TileModel } from '../game/types'

interface Props {
  tile: TileModel
}

/**
 * 单个方块。位置用 CSS 变量 + translate 表达，
 * 配合 transition 实现滑动动画；数值越大字号越小以适应格子。
 */
export function Tile({ tile }: Props) {
  const { row, col, value, isMerged, isNew, isGhost } = tile

  const digits = String(value).length
  const classes = ['tile', `tile-${value <= 2048 ? value : 'super'}`, `tile-digits-${Math.min(digits, 5)}`]
  if (isMerged) classes.push('tile-merged')
  if (isNew) classes.push('tile-new')
  if (isGhost) classes.push('tile-ghost')

  return (
    <div
      className={classes.join(' ')}
      style={
        {
          '--row': row,
          '--col': col,
        } as React.CSSProperties
      }
      aria-hidden={isGhost ? true : undefined}
    >
      <div className="tile-inner">{value}</div>
    </div>
  )
}

/** 棋盘背景的空格子 */
export function GridBackground() {
  return (
    <div className="grid-bg" aria-hidden="true">
      {Array.from({ length: SIZE * SIZE }, (_, i) => (
        <div key={i} className="grid-cell" />
      ))}
    </div>
  )
}
