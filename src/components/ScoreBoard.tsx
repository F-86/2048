interface Props {
  score: number
  best: number
  /** 最近一次分数变化；value 为负表示撤销扣分 */
  gain: { value: number; multiplier: number; key: number } | null
  /** 下一个将要出现的方块数值 */
  nextTile: number
  /** 本局是否已超过开局时的最高分 */
  beatRecord: boolean
}

export function ScoreBoard({ score, best, gain, nextTile, beatRecord }: Props) {
  return (
    <div className="scores">
      <div className="score-box score-box-next" title="下一个出现的方块">
        <div className="score-label">下一个</div>
        <div className={`score-next score-next-${nextTile}`}>{nextTile}</div>
      </div>

      <div className="score-box">
        <div className="score-label">得分</div>
        <div className="score-value">{score}</div>
        {gain && (
          // key 变化时重新挂载，从而重播飘字动画
          <div
            className={`score-gain${gain.value < 0 ? ' score-gain-cost' : ''}`}
            key={gain.key}
          >
            {gain.value < 0 ? gain.value : `+${gain.value}`}
            {/* 只有真的放大过才显示倍率，×1 不值得占位置 */}
            {gain.multiplier > 1 && (
              <span className="score-mult">×{gain.multiplier.toFixed(1)}</span>
            )}
          </div>
        )}
      </div>

      <div className="score-box">
        <div className="score-label">最高分</div>
        <div className="score-value">{best}</div>
        {beatRecord && <div className="score-record">新纪录</div>}
      </div>
    </div>
  )
}
