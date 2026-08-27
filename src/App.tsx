import { Board } from './components/Board'
import { ScoreBoard } from './components/ScoreBoard'
import { useGame } from './game/useGame'
import { useInput } from './game/useInput'
import './styles.css'

export default function App() {
  const { core, best, gain, canUndo, move, undo, restart, keepPlaying } = useGame()
  useInput(move, undo)

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">2048</h1>
        <ScoreBoard score={core.score} best={best} gain={gain} />
      </header>

      <div className="toolbar">
        <p className="hint">
          用<strong>方向键</strong>或<strong>滑动</strong>合并相同数字，凑出 <strong>2048</strong>
        </p>
        <div className="toolbar-actions">
          <button className="btn" onClick={undo} disabled={!canUndo} title="撤销上一步（Z）">
            撤销
          </button>
          <button className="btn btn-primary" onClick={restart}>
            新游戏
          </button>
        </div>
      </div>

      <Board core={core} onRestart={restart} onKeepPlaying={keepPlaying} />

      <footer className="footer">
        方向键 / WASD / HJKL 移动 · Z 撤销 · 手机在棋盘上滑动
      </footer>
    </div>
  )
}
