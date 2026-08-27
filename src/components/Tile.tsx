import { type Tile as TileModel } from '../game/types'

interface Props {
  tile: TileModel
}

/** 火花的方向数：合并时向 12 个方向迸发（越密越像「炸开」） */
const SPARKS = 12

/**
 * 单个方块。位置用 CSS 变量 + translate 表达，
 * 配合 transition 实现滑动动画；数值越大字号越小以适应格子。
 *
 * 合并时叠加三层「爽感」装饰（全部纯展示、不参与无障碍）：
 * 高光一闪、火花迸发、以及在方块处向上飘出的 +N 得分。
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

      {isMerged && (
        <div className="tile-fx" aria-hidden="true">
          {/* 向外扩散的冲击波光环 */}
          <div className="tile-shockwave" />
          {/* 高光一闪：合并瞬间整格发亮 */}
          <div className="tile-flash" />
          {/* 火花：12 个方向各飞出一颗，方向由 --i 决定，纯 CSS，无随机 */}
          <div className="tile-sparks">
            {Array.from({ length: SPARKS }, (_, i) => (
              <span
                key={i}
                className="spark"
                style={{ '--i': i, '--n': SPARKS } as React.CSSProperties}
              />
            ))}
          </div>
          {/* 在方块处飘出的得分：这一对合成的值即它的贡献 */}
          <div className="tile-gain">+{value}</div>
        </div>
      )}
    </div>
  )
}

/** 棋盘背景的空格子 */
export function GridBackground({ size }: { size: number }) {
  return (
    <div className="grid-bg" aria-hidden="true">
      {Array.from({ length: size * size }, (_, i) => (
        <div key={i} className="grid-cell" />
      ))}
    </div>
  )
}
