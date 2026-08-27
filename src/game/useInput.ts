import { useEffect } from 'react'
import type { Direction } from './types'

const KEY_MAP: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  // Vim 风格
  k: 'up',
  j: 'down',
  h: 'left',
  l: 'right',
  // WASD
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
}

/** 触摸被识别为滑动所需的最小距离（像素） */
const SWIPE_THRESHOLD = 24

/** 绑定键盘方向键与触摸滑动，转换成移动指令 */
export function useInput(
  onMove: (dir: Direction) => void,
  onUndo: () => void,
  onToggleMute?: () => void,
) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 让浏览器保留组合键（如 ⌘R 刷新）
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        onUndo()
        return
      }

      if (onToggleMute && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault()
        onToggleMute()
        return
      }

      const dir = KEY_MAP[e.key]
      if (dir) {
        // 阻止方向键滚动页面
        e.preventDefault()
        onMove(dir)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onMove, onUndo, onToggleMute])

  useEffect(() => {
    let startX = 0
    let startY = 0
    let tracking = false

    const onTouchStart = (e: TouchEvent) => {
      // 只接管棋盘内的单指触摸，页面其他区域保持正常滚动
      const target = e.target instanceof Element ? e.target : null
      if (e.touches.length !== 1 || !target?.closest('.board')) {
        tracking = false
        return
      }
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      tracking = true
    }

    const onTouchMove = (e: TouchEvent) => {
      // 仅在棋盘内滑动时阻止页面橡皮筋滚动
      if (tracking) e.preventDefault()
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false

      const touch = e.changedTouches[0]
      if (!touch) return

      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      const absX = Math.abs(dx)
      const absY = Math.abs(dy)

      if (Math.max(absX, absY) < SWIPE_THRESHOLD) return

      // 取位移较大的轴向作为滑动方向
      if (absX > absY) {
        onMove(dx > 0 ? 'right' : 'left')
      } else {
        onMove(dy > 0 ? 'down' : 'up')
      }
    }

    // passive: false 才能在 touchmove 中调用 preventDefault
    window.addEventListener('touchstart', onTouchStart, { passive: false })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)

    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [onMove])
}
