import { Board } from './components/Board'
import { ComboMeter } from './components/ComboMeter'
import { ScoreBoard } from './components/ScoreBoard'
import { useGame } from './game/useGame'
import { useInput } from './game/useInput'
import { BOARD_SIZES } from './game/types'
import './styles.css'

export default function App() {
  const {
    core,
    size,
    best,
    gain,
    canUndo,
    muted,
    danger,
    beatRecord,
    stats,
    maxTile,
    shakeSeq,
    shakeMag,
    celebrate,
    clearCelebrate,
    streak,
    nextTile,
    undoCost,
    move,
    undo,
    restart,
    keepPlaying,
    toggleMute,
    setSize,
  } = useGame()
  useInput(move, undo, toggleMute)

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">2048</h1>
        <ScoreBoard
          score={core.score}
          best={best}
          gain={gain}
          nextTile={nextTile}
          beatRecord={beatRecord}
        />
      </header>

      <div className="toolbar">
        <p className="hint">
          用<strong>方向键</strong>或<strong>滑动</strong>合并相同数字，凑出 <strong>2048</strong>
          <br />
          一次合并多对有<strong>连锁加成</strong>，连续合并再叠<strong>连击</strong>
        </p>
        <div className="toolbar-actions">
          <button
            className="btn btn-icon"
            onClick={toggleMute}
            title={muted ? '开启音效' : '关闭音效'}
            aria-label={muted ? '开启音效' : '关闭音效'}
            aria-pressed={muted}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <div className="seg" role="group" aria-label="棋盘尺寸">
            {BOARD_SIZES.map((n) => (
              <button
                key={n}
                className={`seg-btn${n === size ? ' seg-btn-on' : ''}`}
                onClick={() => setSize(n)}
                title={`切换到 ${n}×${n}（各尺寸进度独立保存）`}
                aria-pressed={n === size}
              >
                {n}×{n}
              </button>
            ))}
          </div>
          <button
            className="btn"
            onClick={undo}
            disabled={!canUndo}
            title={`撤销上一步（Z）—— 花费 ${undoCost} 分`}
          >
            撤销
            {/* 费用另起一个 aria-hidden 的节点，让按钮的无障碍名仍是「撤销」 */}
            <span className="btn-cost" aria-hidden="true">
              -{undoCost}
            </span>
          </button>
          <button className="btn btn-primary" onClick={restart}>
            新游戏
          </button>
        </div>
      </div>

      <Board
        core={core}
        danger={danger}
        stats={stats}
        maxTile={maxTile}
        beatRecord={beatRecord}
        shakeSeq={shakeSeq}
        shakeMag={shakeMag}
        celebrate={celebrate}
        onCelebrateEnd={clearCelebrate}
        onRestart={restart}
        onKeepPlaying={keepPlaying}
      />

      <footer className="footer">
        方向键 / WASD / HJKL 移动 · Z 撤销 · M 静音 · 手机在棋盘上滑动
      </footer>

      {/* 连击喇叭固定在屏幕右上角，脱离棋盘，不遮挡方块 */}
      <ComboMeter streak={streak} />
    </div>
  )
}
