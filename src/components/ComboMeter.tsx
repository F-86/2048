import { useEffect, useRef, useState } from 'react'

/** 连击等级对应的赞美文案，越连越夸张（消消乐风） */
const COMBO_WORDS = ['连击', '好棒', '厉害', '超棒', '太强了', '无敌', '势不可挡']

/**
 * 连击断了之后喇叭还停留多久（毫秒）才淡出。
 * 之前 streak 一归零就立刻卸载，一闪就没了；这里给一段缓冲，让爽感留在屏幕上。
 */
const LINGER_MS = 2600

/**
 * 屏幕右上角的连击喇叭（固定定位，不画在棋盘里）。
 *
 * 显示的连击数与实时 streak 解耦：streak 增长时立即跟上并弹跳；
 * streak 归零时不马上消失，而是进入「停留 + 淡出」，LINGER_MS 后才真正卸载。
 * 若停留期间又连上了，取消淡出、直接接住新的连击。
 */
export function ComboMeter({ streak }: { streak: number }) {
  const [display, setDisplay] = useState(streak >= 2 ? streak : 0)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (streak >= 2) {
      // 连击进行中：跟上最新数字，取消任何待执行的淡出
      clearTimeout(timer.current)
      setDisplay(streak)
      setLeaving(false)
    } else {
      // 连击断了：先停留，LINGER_MS 后才卸载
      setLeaving(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setDisplay(0), LINGER_MS)
    }
    return () => clearTimeout(timer.current)
  }, [streak])

  if (display < 2) return null

  const word = COMBO_WORDS[Math.min(display - 2, COMBO_WORDS.length - 1)]
  // 颜色 / 字号分档，封顶到 7 走「彩虹」
  const level = Math.min(display, 7)

  return (
    <div
      className={`combo-meter${leaving ? ' combo-leaving' : ''}`}
      data-level={level}
      aria-hidden="true"
    >
      {/* key=display：每次连击数变化就重挂载，重播弹跳 */}
      <div className="combo-inner" key={display}>
        <span className="combo-word">{word}</span>
        <span className="combo-count">×{display}</span>
      </div>
    </div>
  )
}
