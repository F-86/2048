import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'

/** 读出棋盘上所有活方块的数值（排除残影） */
function visibleValues(): number[] {
  return Array.from(document.querySelectorAll('.tile'))
    .filter((el) => !el.classList.contains('tile-ghost'))
    .map((el) => Number(el.textContent))
}

function scoreValue(): number {
  const box = screen.getByText('得分').parentElement!
  return Number(box.querySelector('.score-value')!.textContent)
}

function press(key: string) {
  act(() => {
    fireEvent.keyDown(window, { key })
  })
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('App — 初始渲染', () => {
  it('渲染标题、分数与 16 个背景格', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: '2048' })).toBeDefined()
    expect(screen.getByText('得分')).toBeDefined()
    expect(screen.getByText('最高分')).toBeDefined()
    expect(document.querySelectorAll('.grid-cell').length).toBe(16)
  })

  it('开局有两个方块，初始分数为 0', () => {
    render(<App />)
    expect(visibleValues().length).toBe(2)
    expect(scoreValue()).toBe(0)
  })
})

describe('App — 键盘交互', () => {
  it('方向键能改变棋盘（新增方块）', () => {
    render(<App />)
    // 连续尝试四个方向，至少有一个方向可移动，从而生成第三个方块
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
      press(key)
      if (visibleValues().length > 2) break
    }
    expect(visibleValues().length).toBeGreaterThan(2)
  })

  it('WASD 与 HJKL 同样能操作', () => {
    render(<App />)
    for (const key of ['a', 'w', 'd', 's', 'h', 'k', 'l', 'j']) {
      press(key)
      if (visibleValues().length > 2) break
    }
    expect(visibleValues().length).toBeGreaterThan(2)
  })

  it('带修饰键的按键不触发移动（保留浏览器快捷键）', () => {
    render(<App />)
    const before = visibleValues().length
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowLeft', metaKey: true })
    })
    expect(visibleValues().length).toBe(before)
  })
})

describe('App — 撤销', () => {
  it('初始状态下撤销按钮禁用', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: '撤销' }).hasAttribute('disabled')).toBe(true)
  })

  it('移动后可撤销，且恢复到移动前的方块数', () => {
    render(<App />)
    const before = visibleValues().length

    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
      press(key)
      if (visibleValues().length > before) break
    }
    const undoBtn = screen.getByRole('button', { name: '撤销' })
    expect(undoBtn.hasAttribute('disabled')).toBe(false)

    act(() => {
      fireEvent.click(undoBtn)
    })
    expect(visibleValues().length).toBe(before)
  })

  it('按 Z 键也能撤销', () => {
    render(<App />)
    const before = visibleValues().length
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
      press(key)
      if (visibleValues().length > before) break
    }
    press('z')
    expect(visibleValues().length).toBe(before)
  })
})

describe('App — 新游戏', () => {
  it('点击新游戏重置棋盘与分数', () => {
    render(<App />)
    for (let i = 0; i < 12; i++) {
      press(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'][i % 4])
    }

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '新游戏' }))
    })

    expect(visibleValues().length).toBe(2)
    expect(scoreValue()).toBe(0)
    expect(screen.getByRole('button', { name: '撤销' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('App — 持久化', () => {
  it('刷新后恢复上一局的分数与棋盘', () => {
    const { unmount } = render(<App />)
    for (let i = 0; i < 16; i++) {
      press(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'][i % 4])
    }
    const savedScore = scoreValue()
    const savedTiles = visibleValues().length
    unmount()

    render(<App />)
    expect(scoreValue()).toBe(savedScore)
    expect(visibleValues().length).toBe(savedTiles)
  })

  it('存档损坏时回退到新对局而不崩溃', () => {
    localStorage.setItem('react-2048/state-v1', '{不是合法 JSON')
    render(<App />)
    expect(visibleValues().length).toBe(2)
    expect(scoreValue()).toBe(0)
  })

  it('最高分跨对局保留', () => {
    const { unmount } = render(<App />)
    for (let i = 0; i < 20; i++) {
      press(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'][i % 4])
    }
    const earned = scoreValue()
    unmount()

    render(<App />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '新游戏' }))
    })
    const best = Number(screen.getByText('最高分').parentElement!.querySelector('.score-value')!.textContent)
    expect(best).toBeGreaterThanOrEqual(earned)
    expect(scoreValue()).toBe(0)
  })
})

describe('App — 触摸滑动', () => {
  /** 构造一次滑动手势；target 决定手势起点落在哪个元素上 */
  function swipe(target: Element, dx: number, dy: number) {
    const start = { clientX: 200, clientY: 200 }
    act(() => {
      fireEvent.touchStart(target, { touches: [start], targetTouches: [start] })
    })
    const moved = { clientX: start.clientX + dx, clientY: start.clientY + dy }
    const moveEvent = new TouchEvent('touchmove', {
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      target.dispatchEvent(moveEvent)
    })
    act(() => {
      fireEvent.touchEnd(target, { changedTouches: [moved] })
    })
    return moveEvent
  }

  it('在棋盘上滑动能移动方块', () => {
    render(<App />)
    const board = document.querySelector('.board')!
    const before = visibleValues().length

    // 四个方向轮流试，至少一个方向可移动
    for (const [dx, dy] of [
      [-120, 0],
      [0, -120],
      [120, 0],
      [0, 120],
    ]) {
      swipe(board, dx, dy)
      if (visibleValues().length > before) break
    }
    expect(visibleValues().length).toBeGreaterThan(before)
  })

  it('棋盘内滑动阻止默认行为（防止页面橡皮筋滚动）', () => {
    render(<App />)
    const board = document.querySelector('.board')!
    const ev = swipe(board, -120, 0)
    expect(ev.defaultPrevented).toBe(true)
  })

  it('棋盘外滑动不阻止默认行为，页面仍可正常滚动', () => {
    render(<App />)
    const footer = document.querySelector('.footer')!
    const ev = swipe(footer, 0, -120)
    expect(ev.defaultPrevented).toBe(false)
  })

  it('棋盘外滑动不会移动方块', () => {
    render(<App />)
    const footer = document.querySelector('.footer')!
    const before = visibleValues().length
    for (const [dx, dy] of [
      [-120, 0],
      [0, -120],
      [120, 0],
      [0, 120],
    ]) {
      swipe(footer, dx, dy)
    }
    expect(visibleValues().length).toBe(before)
  })

  it('滑动距离过短时忽略，避免误触', () => {
    render(<App />)
    const board = document.querySelector('.board')!
    const before = visibleValues().length
    swipe(board, -8, 0)
    expect(visibleValues().length).toBe(before)
  })
})

describe('App — 方块定位', () => {
  it('每个方块都带有行列 CSS 变量，用于 transform 定位', () => {
    render(<App />)
    const tiles = Array.from(document.querySelectorAll('.tile')) as HTMLElement[]
    expect(tiles.length).toBeGreaterThan(0)
    for (const tile of tiles) {
      const row = tile.style.getPropertyValue('--row')
      const col = tile.style.getPropertyValue('--col')
      expect(row).not.toBe('')
      expect(col).not.toBe('')
      expect(Number(row)).toBeGreaterThanOrEqual(0)
      expect(Number(row)).toBeLessThan(4)
      expect(Number(col)).toBeGreaterThanOrEqual(0)
      expect(Number(col)).toBeLessThan(4)
    }
  })

  it('新生成的方块带 tile-new 类以播放出现动画', () => {
    render(<App />)
    expect(document.querySelectorAll('.tile-new').length).toBeGreaterThan(0)
  })
})
