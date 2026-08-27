import { WIN_VALUE, type Core } from '../game/types'
import { GridBackground, Tile } from './Tile'

interface Props {
  core: Core
  onRestart: () => void
  onKeepPlaying: () => void
}

export function Board({ core, onRestart, onKeepPlaying }: Props) {
  const showWin = core.won && !core.keepPlaying
  const showOver = core.over && !showWin

  // 按 id 排序保证 DOM 顺序稳定：React 若为了匹配数组顺序而移动节点，
  // 会打断正在进行的 CSS transition，方块就会「跳」而不是滑动。
  // 层叠关系交给 z-index（.tile-ghost）处理，不依赖 DOM 顺序。
  const tiles = [...core.tiles].sort((a, b) => a.id - b.id)

  return (
    <div className="board">
      <GridBackground />

      <div className="tiles">
        {tiles.map((tile) => (
          <Tile key={tile.id} tile={tile} />
        ))}
      </div>

      {showWin && (
        <div className="overlay overlay-win" role="alertdialog" aria-label="你赢了">
          <p className="overlay-title">你赢了！</p>
          <p className="overlay-sub">已达成 {WIN_VALUE}</p>
          <div className="overlay-actions">
            <button className="btn btn-primary" onClick={onKeepPlaying}>
              继续挑战
            </button>
            <button className="btn" onClick={onRestart}>
              重新开始
            </button>
          </div>
        </div>
      )}

      {showOver && (
        <div className="overlay overlay-over" role="alertdialog" aria-label="游戏结束">
          <p className="overlay-title">游戏结束</p>
          <p className="overlay-sub">最终得分 {core.score}</p>
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
