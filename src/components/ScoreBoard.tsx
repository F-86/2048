interface Props {
  score: number
  best: number
  gain: { value: number; key: number } | null
}

export function ScoreBoard({ score, best, gain }: Props) {
  return (
    <div className="scores">
      <div className="score-box">
        <div className="score-label">得分</div>
        <div className="score-value">{score}</div>
        {gain && (
          // key 变化时重新挂载，从而重播飘字动画
          <div className="score-gain" key={gain.key}>
            +{gain.value}
          </div>
        )}
      </div>
      <div className="score-box">
        <div className="score-label">最高分</div>
        <div className="score-value">{best}</div>
      </div>
    </div>
  )
}
