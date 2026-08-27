import { WIN_VALUE, type Core } from '../game/types'
import type { RunStats } from '../game/useGame'
import { GridBackground, Tile } from './Tile'

interface Props {
  core: Core
  /** 空格将尽，棋盘泛红提示 */
  danger: boolean
  /** 本局统计，用于结束时的复盘 */
  stats: RunStats
  /** 本局最大的方块 */
  maxTile: number
  /** 本局是否超过了开局时的最高分 */
  beatRecord: boolean
  /** 震动序号，每次变化播放一次震动 */
  shakeSeq: number
  /** 震动强度倍率，越大晃得越狠 */
  shakeMag: number
  /** 正在庆祝的里程碑（横幅 + 彩纸），为 null 时不显示 */
  celebrate: { value: number; key: number } | null
  /** 庆祝动画播完的回调，用于清除庆祝态 */
  onCelebrateEnd: () => void
  onRestart: () => void
  onKeepPlaying: () => void
}

/** 里程碑庆祝层：横幅 + 一把彩纸，纯装饰 */
function Celebrate({
  value,
  onEnd,
}: {
  value: number
  onEnd: () => void
}) {
  const CONFETTI = 18
  return (
    <div className="celebrate" aria-hidden="true">
      <div className="confetti">
        {Array.from({ length: CONFETTI }, (_, i) => (
          <span
            key={i}
            className="confetto"
            style={{ '--i': i, '--n': CONFETTI } as React.CSSProperties}
          />
        ))}
      </div>
      {/* 横幅动画最长，用它的结束来清除整个庆祝层 */}
      <div className="milestone-banner" onAnimationEnd={onEnd}>
        {value}!
      </div>
    </div>
  )
}

/** 结束时的复盘卡片：把一局的过程讲成几个数字 */
function Recap({
  score,
  maxTile,
  stats,
  beatRecord,
}: Pick<Props, 'stats' | 'maxTile' | 'beatRecord'> & { score: number }) {
  const rows: [string, string | number][] = [
    ['最终得分', score],
    ['最大方块', maxTile],
    ['移动步数', stats.moves],
    ['合并次数', stats.merges],
    ['最长连击', stats.bestStreak],
    ['撤销次数', stats.undos],
  ]

  return (
    <div className="recap">
      {beatRecord && <p className="recap-record">🏆 新纪录！</p>}
      <dl className="recap-grid">
        {rows.map(([label, value]) => (
          <div className="recap-item" key={label}>
            <dt className="recap-label">{label}</dt>
            <dd className="recap-value">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function Board({
  core,
  danger,
  stats,
  maxTile,
  beatRecord,
  shakeSeq,
  shakeMag,
  celebrate,
  onCelebrateEnd,
  onRestart,
  onKeepPlaying,
}: Props) {
  // 赢了又同时无路可走时，优先展示胜利遮罩，但复盘要跟着一起给出，
  // 否则玩家点了「继续挑战」才看到一张属于已胜局的结束卡片
  const showWin = core.won && !core.keepPlaying
  const showOver = core.over && !showWin
  const overlayVisible = showWin || showOver

  // 按 id 排序保证 DOM 顺序稳定：React 若为了匹配数组顺序而移动节点，
  // 会打断正在进行的 CSS transition，方块就会「跳」而不是滑动。
  // 层叠关系交给 z-index（.tile-ghost）处理，不依赖 DOM 顺序。
  const tiles = [...core.tiles].sort((a, b) => a.id - b.id)

  /*
   * 震动用两个内容相同、名字不同的动画交替触发：
   * 同一个类名重复添加不会重播动画，而给 .board 换 key 会重建所有方块节点、
   * 打断正在进行的滑动过渡。交替类名两者都能避免。
   */
  const shakeClass = shakeSeq > 0 ? ` board-shake-${shakeSeq % 2}` : ''

  return (
    <div
      className={`board${danger && !overlayVisible ? ' board-danger' : ''}${shakeClass}`}
      data-size={core.size}
      // 覆盖 :root 的默认值，.grid-bg 的 repeat() 与 .tile 的位置公式都会跟随；
      // --shake-mag 供震动关键帧按强度缩放位移
      style={{ '--size': core.size, '--shake-mag': shakeMag } as React.CSSProperties}
    >
      <GridBackground size={core.size} />

      {/*
       * key 带上尺寸：切换尺寸时 id 会从 1 重新开始，若沿用纯 id 作为 key，
       * React 会复用上一个尺寸的 DOM 节点，而节点上残留的 transform
       * 是按旧格子尺寸算出的，方块会停在错位的位置。
       * 换 key 迫使 React 重建节点，位置从新尺寸重新计算。
       */}
      <div className="tiles" key={core.size}>
        {tiles.map((tile) => (
          <Tile key={tile.id} tile={tile} />
        ))}
      </div>

      {/* key 带上里程碑序号：每次新里程碑都重挂载，动画从头重播 */}
      {celebrate && (
        <Celebrate key={celebrate.key} value={celebrate.value} onEnd={onCelebrateEnd} />
      )}

      {showWin && (
        <div className="overlay overlay-win" role="alertdialog" aria-label="你赢了">
          <p className="overlay-title">你赢了！</p>
          <p className="overlay-sub">已达成 {WIN_VALUE}</p>
          {/* 同一步既达成 2048 又走不动了，这局就此结束，直接给复盘 */}
          {core.over ? (
            <>
              <Recap
                score={core.score}
                maxTile={maxTile}
                stats={stats}
                beatRecord={beatRecord}
              />
              <div className="overlay-actions">
                <button className="btn btn-primary" onClick={onRestart}>
                  再来一局
                </button>
              </div>
            </>
          ) : (
            <div className="overlay-actions">
              <button className="btn btn-primary" onClick={onKeepPlaying}>
                继续挑战
              </button>
              <button className="btn" onClick={onRestart}>
                重新开始
              </button>
            </div>
          )}
        </div>
      )}

      {showOver && (
        <div className="overlay overlay-over" role="alertdialog" aria-label="游戏结束">
          <p className="overlay-title">游戏结束</p>
          <Recap score={core.score} maxTile={maxTile} stats={stats} beatRecord={beatRecord} />
          <div className="overlay-actions">
            <button className="btn btn-primary" onClick={onRestart}>
              再来一局
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
