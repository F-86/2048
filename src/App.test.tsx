import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

/**
 * 读出棋盘上所有活方块的数值（排除残影）。
 * 只读 .tile-inner 的文字：合并时 .tile 里还挂着装饰性的「+N」飘分，
 * 直接读 .tile 的 textContent 会把数字和飘分拼在一起变成 NaN。
 */
function visibleValues(): number[] {
  return Array.from(document.querySelectorAll('.tile'))
    .filter((el) => !el.classList.contains('tile-ghost'))
    .map((el) => Number(el.querySelector('.tile-inner')?.textContent))
}

function scoreValue(): number {
  const box = screen.getByText('得分').parentElement!
  return Number(box.querySelector('.score-value')!.textContent)
}

function bestValue(): number {
  const box = screen.getByText('最高分').parentElement!
  return Number(box.querySelector('.score-value')!.textContent)
}

function press(key: string) {
  act(() => {
    fireEvent.keyDown(window, { key })
  })
}

/** 撤销的分数代价，与 types.ts 的 UNDO_COST 保持一致 */
const UNDO_COST = 500

/**
 * 写入一份「分数足够付撤销费」的存档，并预置一步可撤销的历史。
 * 撤销要花 500 分，靠按方向键在测试里攒不到，只能预先塞存档。
 */
function seedRichSave(size: 4 | 5 = 4, score = 5000) {
  const core = {
    size,
    tiles: [
      { id: 1, row: 0, col: 0, value: 2 },
      { id: 2, row: 0, col: 1, value: 2 },
    ],
    score,
    won: false,
    keepPlaying: false,
    over: false,
    nextId: 3,
    next: 2,
    streak: 0,
  }
  localStorage.setItem('react-2048/size-v1', String(size))
  localStorage.setItem(
    `react-2048/state-v2-${size}x${size}`,
    JSON.stringify({ core, history: [core] }),
  )
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

  it('分数不够付撤销费时按钮禁用', () => {
    render(<App />)
    const before = visibleValues().length
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
      press(key)
      if (visibleValues().length > before) break
    }
    // 确实走了一步（有可撤销的历史），但分数远不够 500
    expect(scoreValue()).toBeLessThan(UNDO_COST)
    expect(screen.getByRole('button', { name: '撤销' }).hasAttribute('disabled')).toBe(true)
  })

  it('分数不够时按 Z 键也不能撤销（绕不过按钮的限制）', () => {
    render(<App />)
    const before = visibleValues().length
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
      press(key)
      if (visibleValues().length > before) break
    }
    const tilesAfterMove = visibleValues().length
    press('z')
    expect(visibleValues().length).toBe(tilesAfterMove)
  })

  it('分数足够时可撤销，并扣掉 500 分', () => {
    seedRichSave(4, 5000)
    render(<App />)
    const undoBtn = screen.getByRole('button', { name: '撤销' })
    expect(undoBtn.hasAttribute('disabled')).toBe(false)

    act(() => {
      fireEvent.click(undoBtn)
    })
    expect(scoreValue()).toBe(4500)
  })

  it('按 Z 键也能撤销并扣分', () => {
    seedRichSave(4, 5000)
    render(<App />)
    press('z')
    expect(scoreValue()).toBe(4500)
  })

  it('撤销不降低最高分', () => {
    seedRichSave(4, 5000)
    render(<App />)
    const bestBefore = bestValue()
    press('z')
    expect(scoreValue()).toBe(4500)
    expect(bestValue()).toBe(bestBefore)
  })

  it('撤销后分数不足则不能再撤销', () => {
    // 只够付一次
    seedRichSave(4, UNDO_COST)
    render(<App />)
    press('z')
    expect(scoreValue()).toBe(0)
    expect(screen.getByRole('button', { name: '撤销' }).hasAttribute('disabled')).toBe(true)
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
    localStorage.setItem('react-2048/state-v2-4x4', '{不是合法 JSON')
    render(<App />)
    expect(visibleValues().length).toBe(2)
    expect(scoreValue()).toBe(0)
  })

  it('v1 旧存档被迁移，进度不丢失', () => {
    // v1 的 core 没有 size 字段，只可能是 4×4
    localStorage.setItem(
      'react-2048/state-v1',
      JSON.stringify({
        core: {
          tiles: [
            { id: 1, row: 0, col: 0, value: 8 },
            { id: 2, row: 3, col: 3, value: 16 },
          ],
          score: 320,
          won: false,
          keepPlaying: false,
          over: false,
          nextId: 3,
        },
        history: [],
      }),
    )
    localStorage.setItem('react-2048/best-v1', '1024')

    render(<App />)
    expect(scoreValue()).toBe(320)
    expect(bestValue()).toBe(1024)
    expect(visibleValues().sort((a, b) => a - b)).toEqual([8, 16])
  })

  it('v1 旧存档损坏时回退到新对局', () => {
    localStorage.setItem('react-2048/state-v1', '{坏数据')
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
    const best = bestValue()
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

describe('App — 音效开关', () => {
  /** 静音按钮是工具栏第一个按钮，用 aria-label 定位 */
  const muteBtn = () => screen.getByRole('button', { name: /音效/ })

  it('默认开启音效，按钮显示为未静音', () => {
    render(<App />)
    expect(muteBtn().getAttribute('aria-pressed')).toBe('false')
    expect(muteBtn().textContent).toBe('🔊')
  })

  it('点击切换静音状态', () => {
    render(<App />)
    act(() => {
      fireEvent.click(muteBtn())
    })
    expect(muteBtn().getAttribute('aria-pressed')).toBe('true')
    expect(muteBtn().textContent).toBe('🔇')

    act(() => {
      fireEvent.click(muteBtn())
    })
    expect(muteBtn().getAttribute('aria-pressed')).toBe('false')
  })

  it('按 M 键切换静音', () => {
    render(<App />)
    press('m')
    expect(muteBtn().getAttribute('aria-pressed')).toBe('true')
    press('M')
    expect(muteBtn().getAttribute('aria-pressed')).toBe('false')
  })

  it('静音偏好在刷新后保留', () => {
    const { unmount } = render(<App />)
    act(() => {
      fireEvent.click(muteBtn())
    })
    unmount()

    render(<App />)
    expect(muteBtn().getAttribute('aria-pressed')).toBe('true')
  })

  it('移动时不会因音效抛错（jsdom 无 AudioContext，应静默降级）', () => {
    render(<App />)
    const before = visibleValues().length
    // 若音效代码未做降级处理，这里会抛异常
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
      press(key)
    }
    expect(visibleValues().length).toBeGreaterThanOrEqual(before)
  })
})

describe('App — 棋盘尺寸切换', () => {
  const sizeBtn = (n: 4 | 5) => screen.getByRole('button', { name: `${n}×${n}` })
  const board = () => document.querySelector('.board') as HTMLElement
  const cellCount = () => document.querySelectorAll('.grid-cell').length

  function switchTo(n: 4 | 5) {
    act(() => {
      fireEvent.click(sizeBtn(n))
    })
  }

  it('默认是 4×4，共 16 个格子', () => {
    render(<App />)
    expect(sizeBtn(4).getAttribute('aria-pressed')).toBe('true')
    expect(sizeBtn(5).getAttribute('aria-pressed')).toBe('false')
    expect(cellCount()).toBe(16)
    expect(board().style.getPropertyValue('--size')).toBe('4')
  })

  it('切到 5×5 后有 25 个格子，CSS 变量同步更新', () => {
    render(<App />)
    switchTo(5)
    expect(cellCount()).toBe(25)
    expect(board().style.getPropertyValue('--size')).toBe('5')
    expect(sizeBtn(5).getAttribute('aria-pressed')).toBe('true')
    expect(sizeBtn(4).getAttribute('aria-pressed')).toBe('false')
  })

  it('5×5 下方块坐标不超过 4', () => {
    render(<App />)
    switchTo(5)
    const tiles = Array.from(document.querySelectorAll('.tile')) as HTMLElement[]
    expect(tiles.length).toBeGreaterThan(0)
    for (const t of tiles) {
      expect(Number(t.style.getPropertyValue('--row'))).toBeLessThan(5)
      expect(Number(t.style.getPropertyValue('--col'))).toBeLessThan(5)
    }
  })

  it('5×5 开局也是两个方块、分数为 0', () => {
    render(<App />)
    switchTo(5)
    expect(visibleValues().length).toBe(2)
    expect(scoreValue()).toBe(0)
  })

  it('两种尺寸各自保存进度，切回来能接着玩', () => {
    render(<App />)
    // 在 4×4 上走几步攒分
    for (let i = 0; i < 14; i++) {
      press(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'][i % 4])
    }
    const score4 = scoreValue()
    const tiles4 = visibleValues().length
    expect(score4).toBeGreaterThan(0)

    // 切到 5×5：全新一局
    switchTo(5)
    expect(scoreValue()).toBe(0)
    for (let i = 0; i < 8; i++) {
      press(['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][i % 4])
    }
    const score5 = scoreValue()

    // 切回 4×4：分数与方块数恢复
    switchTo(4)
    expect(cellCount()).toBe(16)
    expect(scoreValue()).toBe(score4)
    expect(visibleValues().length).toBe(tiles4)

    // 再切到 5×5：那局也还在
    switchTo(5)
    expect(cellCount()).toBe(25)
    expect(scoreValue()).toBe(score5)
  })

  it('最高分按尺寸独立，不会串到另一个尺寸', () => {
    render(<App />)
    for (let i = 0; i < 16; i++) {
      press(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'][i % 4])
    }
    const best4 = bestValue()
    expect(best4).toBeGreaterThan(0)

    switchTo(5)
    // 5×5 是新尺寸，最高分应从 0 开始
    expect(bestValue()).toBe(0)

    switchTo(4)
    expect(bestValue()).toBe(best4)
  })

  it('切换后撤销栈是目标尺寸自己的（新局不可撤销）', () => {
    // 4×4 预置一份分数够撤销的存档，5×5 则是全新一局
    seedRichSave(4, 5000)
    render(<App />)
    const undoBtn = () => screen.getByRole('button', { name: '撤销' })
    expect(undoBtn().hasAttribute('disabled')).toBe(false)

    switchTo(5)
    // 5×5 是全新一局，没有可撤销的步骤
    expect(undoBtn().hasAttribute('disabled')).toBe(true)

    switchTo(4)
    // 4×4 的撤销栈还在
    expect(undoBtn().hasAttribute('disabled')).toBe(false)
  })

  it('最后使用的尺寸在刷新后恢复', () => {
    const { unmount } = render(<App />)
    switchTo(5)
    expect(cellCount()).toBe(25)
    unmount()

    render(<App />)
    expect(cellCount()).toBe(25)
    expect(sizeBtn(5).getAttribute('aria-pressed')).toBe('true')
  })

  it('点击当前尺寸不重置对局', () => {
    render(<App />)
    for (let i = 0; i < 10; i++) {
      press(['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'][i % 4])
    }
    const before = scoreValue()
    const tilesBefore = visibleValues().length

    switchTo(4) // 已经是 4×4
    expect(scoreValue()).toBe(before)
    expect(visibleValues().length).toBe(tilesBefore)
  })

  it('5×5 下新游戏仍是 5×5', () => {
    render(<App />)
    switchTo(5)
    for (let i = 0; i < 6; i++) {
      press(['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'][i % 4])
    }
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '新游戏' }))
    })
    expect(cellCount()).toBe(25)
    expect(visibleValues().length).toBe(2)
    expect(scoreValue()).toBe(0)
  })

  it('5×5 下键盘与撤销正常工作', () => {
    // 5×5 也预置足够的分数，否则撤销买不起
    seedRichSave(5, 5000)
    render(<App />)
    const before = visibleValues().length

    // 预置的两个方块在同一行、不同列，向下必定「只位移不合并」，
    // 因而稳定新增一个方块（不能用随机方向 + 数量判断：横向会把它们合并，数量不变）
    press('ArrowDown')
    expect(visibleValues().length).toBeGreaterThan(before)

    press('z')
    expect(visibleValues().length).toBe(before)
  })
  it('切换尺寸时重建方块容器，避免复用旧节点', () => {
    // 切换尺寸后 id 会从 1 重新开始，若沿用纯 id 作为 key，
    // React 会复用上一个尺寸的 DOM 节点，节点上残留的 transform
    // 是按旧格子尺寸算出的，方块会停在错位的位置。
    // 这里断言容器被真正替换，从而保证节点是新建的。
    render(<App />)
    const before = document.querySelector('.tiles')
    const tileBefore = document.querySelector('.tile')
    expect(before).not.toBeNull()

    switchTo(5)
    const after = document.querySelector('.tiles')
    const tileAfter = document.querySelector('.tile')
    expect(after).not.toBeNull()
    // 必须是不同的 DOM 节点，而非同一节点被复用
    expect(after).not.toBe(before)
    expect(tileAfter).not.toBe(tileBefore)
  })

  it('切换后每个方块的 --row/--col 都落在新尺寸范围内', () => {
    render(<App />)
    switchTo(5)
    const tiles = Array.from(document.querySelectorAll('.tile')) as HTMLElement[]
    expect(tiles.length).toBeGreaterThan(0)
    for (const t of tiles) {
      const row = Number(t.style.getPropertyValue('--row'))
      const col = Number(t.style.getPropertyValue('--col'))
      expect(Number.isInteger(row)).toBe(true)
      expect(Number.isInteger(col)).toBe(true)
      expect(row).toBeGreaterThanOrEqual(0)
      expect(row).toBeLessThan(5)
      expect(col).toBeGreaterThanOrEqual(0)
      expect(col).toBeLessThan(5)
    }

    // 切回 4×4 时同理
    switchTo(4)
    for (const t of Array.from(document.querySelectorAll('.tile')) as HTMLElement[]) {
      expect(Number(t.style.getPropertyValue('--row'))).toBeLessThan(4)
      expect(Number(t.style.getPropertyValue('--col'))).toBeLessThan(4)
    }
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

describe('App — 下一个方块预告', () => {
  it('显示预告值，且是 2 或 4', () => {
    render(<App />)
    const box = screen.getByText('下一个').parentElement!
    const shown = Number(box.querySelector('.score-next')!.textContent)
    expect([2, 4]).toContain(shown)
  })

  it('预告的数值就是下一个真正落下的方块', () => {
    // 用确定性存档：单个方块不在最左列，向左必定「只位移、不合并」，
    // 因而这一步恰好生成一个新方块，且其值必为预告的 next。
    // 不能用随机开局 + 「方块数增加」来判断是否移动：若首步是合并，
    // 数量 2→1→(+1) 仍是 2，循环会继续多按几次，读到的就不是这次预告对应的方块。
    localStorage.setItem('react-2048/size-v1', '4')
    localStorage.setItem(
      'react-2048/state-v2-4x4',
      JSON.stringify({
        core: {
          size: 4,
          tiles: [{ id: 1, row: 0, col: 2, value: 2 }],
          score: 0,
          won: false,
          keepPlaying: false,
          over: false,
          nextId: 2,
          next: 4,
          streak: 0,
        },
        history: [],
      }),
    )
    render(<App />)
    const promised = Number(
      screen.getByText('下一个').parentElement!.querySelector('.score-next')!.textContent,
    )
    expect(promised).toBe(4)

    press('ArrowLeft')

    // 唯一带 tile-new 的就是这次生成的方块（原方块移动后会被剥掉 isNew）
    const spawned = Array.from(document.querySelectorAll('.tile-new')).map((el) =>
      Number(el.textContent),
    )
    expect(spawned).toEqual([promised])
  })
})

describe('App — 连锁与连击', () => {
  /** 用存档摆一个「一次左移能合并两对」的局面 */
  function seedTwoPairs() {
    localStorage.setItem('react-2048/size-v1', '4')
    localStorage.setItem(
      'react-2048/state-v2-4x4',
      JSON.stringify({
        core: {
          size: 4,
          tiles: [
            { id: 1, row: 0, col: 0, value: 2 },
            { id: 2, row: 0, col: 1, value: 2 },
            { id: 3, row: 1, col: 0, value: 4 },
            { id: 4, row: 1, col: 1, value: 4 },
          ],
          score: 0,
          won: false,
          keepPlaying: false,
          over: false,
          nextId: 5,
          next: 2,
          streak: 0,
        },
        history: [],
      }),
    )
  }

  it('一次合并两对时分数带连锁倍率', () => {
    seedTwoPairs()
    render(<App />)
    press('ArrowLeft')
    // 基础分 4+8=12，两对连锁 ×1.5 → 18
    expect(scoreValue()).toBe(18)
  })

  it('连锁时显示倍率并触发棋盘震动', () => {
    seedTwoPairs()
    render(<App />)
    press('ArrowLeft')
    expect(document.querySelector('.score-mult')!.textContent).toBe('×1.5')
    expect(document.querySelector('.board')!.className).toMatch(/board-shake-/)
  })

  it('单对合并不显示倍率', () => {
    render(<App />)
    for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
      press(key)
      if (scoreValue() > 0) break
    }
    // 单对合并倍率为 1，不该占位置
    if (scoreValue() === 4) {
      expect(document.querySelector('.score-mult')).toBeNull()
    }
  })
})

describe('App — 危险预警', () => {
  /** 只留 targetEmpty 个空格的存档 */
  function seedNearFull(targetEmpty: number) {
    const tiles: { id: number; row: number; col: number; value: number }[] = []
    let id = 1
    // 用交替的 2/4 填满，避免相邻同数造成提前结束
    const values = [2, 4]
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        if (16 - tiles.length <= targetEmpty) break
        tiles.push({ id: id++, row, col, value: values[(row + col) % 2] })
      }
    }
    localStorage.setItem('react-2048/size-v1', '4')
    localStorage.setItem(
      'react-2048/state-v2-4x4',
      JSON.stringify({
        core: {
          size: 4,
          tiles,
          score: 1000,
          won: false,
          keepPlaying: false,
          over: false,
          nextId: id,
          next: 2,
          streak: 0,
        },
        history: [],
      }),
    )
  }

  it('空格充裕时棋盘没有危险标记', () => {
    render(<App />)
    expect(document.querySelector('.board')!.classList.contains('board-danger')).toBe(false)
  })

  it('空格降到阈值内时棋盘带上危险标记', () => {
    seedNearFull(2)
    render(<App />)
    expect(document.querySelector('.board')!.classList.contains('board-danger')).toBe(true)
  })
})

describe('App — 局后复盘', () => {
  /** 摆一个只剩一步可走、走完必死的局面 */
  function seedAlmostOver() {
    const tiles: { id: number; row: number; col: number; value: number }[] = []
    let id = 1
    // 除最后一格外全部填上互不相同的相邻值
    const grid = [
      [2, 4, 2, 4],
      [4, 2, 4, 2],
      [2, 4, 2, 4],
      [4, 2, 4, 0],
    ]
    grid.forEach((row, r) =>
      row.forEach((v, c) => {
        if (v !== 0) tiles.push({ id: id++, row: r, col: c, value: v })
      }),
    )
    localStorage.setItem('react-2048/size-v1', '4')
    localStorage.setItem(
      'react-2048/state-v2-4x4',
      JSON.stringify({
        core: {
          size: 4,
          tiles,
          score: 2000,
          won: false,
          keepPlaying: false,
          over: true,
          nextId: id,
          next: 2,
          streak: 0,
        },
        history: [],
      }),
    )
  }

  it('游戏结束时显示复盘卡片的各项统计', () => {
    seedAlmostOver()
    render(<App />)
    expect(screen.getByText('游戏结束')).toBeDefined()
    expect(screen.getByText('最终得分')).toBeDefined()
    expect(screen.getByText('最大方块')).toBeDefined()
    expect(screen.getByText('移动步数')).toBeDefined()
    expect(screen.getByText('合并次数')).toBeDefined()
    expect(screen.getByText('最长连击')).toBeDefined()
    expect(screen.getByText('撤销次数')).toBeDefined()
  })

  it('复盘里的最大方块取自棋盘上真实的最大值', () => {
    seedAlmostOver()
    render(<App />)
    const item = screen.getByText('最大方块').parentElement!
    expect(Number(item.querySelector('.recap-value')!.textContent)).toBe(4)
  })
})

describe('App — StrictMode 下不重复计分', () => {
  /** 摆一个「一次左移合并两对」的局面（与连锁测试同构，但自带 seed 便于独立运行） */
  function seedTwoPairs() {
    localStorage.setItem('react-2048/size-v1', '4')
    localStorage.setItem(
      'react-2048/state-v2-4x4',
      JSON.stringify({
        core: {
          size: 4,
          tiles: [
            { id: 1, row: 0, col: 0, value: 2 },
            { id: 2, row: 0, col: 1, value: 2 },
            { id: 3, row: 1, col: 0, value: 4 },
            { id: 4, row: 1, col: 1, value: 4 },
          ],
          score: 0,
          won: false,
          keepPlaying: false,
          over: false,
          nextId: 5,
          next: 2,
          streak: 0,
        },
        history: [],
      }),
    )
  }

  // main.tsx 把 <App/> 包在 <StrictMode> 里，dev 下 reducer 会被重复执行一次。
  // 这里复刻那个环境，确认一次按键只计一次分（+18），而不是把连锁重复算成 +36/+44。
  it('包在 StrictMode 里，一次按键只合并一次、只计一次分', () => {
    seedTwoPairs()
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    // 落位后棋盘上活方块数：两对各合成 1 个 + 1 个新生成 = 3
    press('ArrowLeft')

    // 基础分 4+8=12，两对连锁 ×1.5 → 18；若 reducer 非幂等被重复应用会变成 36 左右
    expect(scoreValue()).toBe(18)
    expect(document.querySelector('.score-mult')!.textContent).toBe('×1.5')
    // streak 应为 1（本局第一次合并），倍率里不含连击加成
    expect(visibleValues().filter((v) => v === 4 || v === 8).length).toBeGreaterThan(0)
  })

  it('StrictMode 下连续两次按键，分数逐步累加而非翻倍', () => {
    seedTwoPairs()
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
    press('ArrowLeft')
    const afterFirst = scoreValue()
    expect(afterFirst).toBe(18)

    // 再按一次；无论是否还能合并，分数都不该出现「凭空翻倍」
    press('ArrowDown')
    expect(scoreValue()).toBeGreaterThanOrEqual(afterFirst)
    expect(scoreValue()).toBeLessThan(afterFirst * 2)
  })
})

describe('App — 里程碑庆祝', () => {
  function seed4x4(tiles: { id: number; row: number; col: number; value: number }[], score = 0) {
    localStorage.setItem('react-2048/size-v1', '4')
    localStorage.setItem(
      'react-2048/state-v2-4x4',
      JSON.stringify({
        core: {
          size: 4,
          tiles,
          score,
          won: false,
          keepPlaying: false,
          over: false,
          nextId: tiles.length + 1,
          next: 2,
          streak: 0,
        },
        history: [],
      }),
    )
  }

  it('本局最大方块达到 128 时弹出庆祝横幅与彩纸', () => {
    seed4x4([
      { id: 1, row: 0, col: 0, value: 64 },
      { id: 2, row: 0, col: 1, value: 64 },
    ])
    render(<App />)
    // 载入时最大只有 64，不该有庆祝
    expect(document.querySelector('.milestone-banner')).toBeNull()

    press('ArrowLeft') // 64 + 64 → 128
    const banner = document.querySelector('.milestone-banner')
    expect(banner).not.toBeNull()
    expect(banner!.textContent).toBe('128!')
    expect(document.querySelectorAll('.confetto').length).toBeGreaterThan(0)
  })

  it('读档进入一个已经很大的局面时，加载不触发庆祝', () => {
    seed4x4(
      [
        { id: 1, row: 0, col: 0, value: 512 },
        { id: 2, row: 1, col: 1, value: 2 },
      ],
      5000,
    )
    render(<App />)
    expect(document.querySelector('.milestone-banner')).toBeNull()
  })

  it('未到里程碑的小合并不触发庆祝', () => {
    seed4x4([
      { id: 1, row: 0, col: 0, value: 8 },
      { id: 2, row: 0, col: 1, value: 8 },
    ])
    render(<App />)
    press('ArrowLeft') // 8 + 8 → 16，远未到 128
    expect(document.querySelector('.milestone-banner')).toBeNull()
  })
})

describe('App — 右上角连击喇叭', () => {
  /** 存档可带上任意 streak（连击数随对局持久化） */
  function seedWithStreak(
    streak: number,
    tiles: { id: number; row: number; col: number; value: number }[],
  ) {
    localStorage.setItem('react-2048/size-v1', '4')
    localStorage.setItem(
      'react-2048/state-v2-4x4',
      JSON.stringify({
        core: {
          size: 4,
          tiles,
          score: 0,
          won: false,
          keepPlaying: false,
          over: false,
          nextId: tiles.length + 1,
          next: 2,
          streak,
        },
        history: [],
      }),
    )
  }

  it('连击达到 2 起时右上角出现连击喇叭，显示连击数', () => {
    seedWithStreak(3, [{ id: 1, row: 0, col: 0, value: 2 }])
    render(<App />)
    const meter = document.querySelector('.combo-meter')
    expect(meter).not.toBeNull()
    expect(meter!.querySelector('.combo-count')!.textContent).toBe('×3')
  })

  it('连击不足 2 时不显示', () => {
    seedWithStreak(1, [{ id: 1, row: 0, col: 0, value: 2 }])
    render(<App />)
    expect(document.querySelector('.combo-meter')).toBeNull()
  })

  it('走出一步没有合并时连击断裂，喇叭先停留再淡出', () => {
    vi.useFakeTimers()
    try {
      // 单个方块不在最左列：向左只位移、不合并 → streak 归零
      seedWithStreak(3, [{ id: 1, row: 0, col: 2, value: 2 }])
      render(<App />)
      expect(document.querySelector('.combo-meter')).not.toBeNull()

      press('ArrowLeft') // streak → 0
      // 不立刻消失：仍在，进入停留 / 淡出态
      const meter = document.querySelector('.combo-meter')
      expect(meter).not.toBeNull()
      expect(meter!.classList.contains('combo-leaving')).toBe(true)

      // 停留时间过后才真正卸载
      act(() => {
        vi.advanceTimersByTime(3000)
      })
      expect(document.querySelector('.combo-meter')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
