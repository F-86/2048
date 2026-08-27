import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  isValidCore,
  loadBest,
  loadSaved,
  loadSize,
  saveBest,
  saveGame,
  saveSize,
} from './storage'
import type { BoardSize, Core } from './types'

/** 构造一份合法的 core */
function makeCore(size: BoardSize, overrides: Partial<Core> = {}): Core {
  return {
    size,
    tiles: [
      { id: 1, row: 0, col: 0, value: 2 },
      { id: 2, row: size - 1, col: size - 1, value: 4 },
    ],
    score: 100,
    won: false,
    keepPlaying: false,
    over: false,
    nextId: 3,
    next: 2,
    streak: 0,
    ...overrides,
  }
}

const V1_STATE = 'react-2048/state-v1'
const V1_BEST = 'react-2048/best-v1'
const K4 = 'react-2048/state-v2-4x4'
const K5 = 'react-2048/state-v2-5x5'

beforeEach(() => localStorage.clear())
afterEach(() => localStorage.clear())

describe('isValidCore', () => {
  it('接受合法的 core', () => {
    expect(isValidCore(makeCore(4), 4)).toBe(true)
    expect(isValidCore(makeCore(5), 5)).toBe(true)
  })

  it('拒绝尺寸不符的 core', () => {
    expect(isValidCore(makeCore(4), 5)).toBe(false)
    expect(isValidCore(makeCore(5), 4)).toBe(false)
  })

  it('拒绝坐标越界的方块', () => {
    const bad = makeCore(4, { tiles: [{ id: 1, row: 4, col: 0, value: 2 }] })
    expect(isValidCore(bad, 4)).toBe(false)

    const negative = makeCore(4, { tiles: [{ id: 1, row: -1, col: 0, value: 2 }] })
    expect(isValidCore(negative, 4)).toBe(false)
  })

  it('5×5 接受 row/col 为 4 的方块（4×4 则不接受）', () => {
    const tiles = [{ id: 1, row: 4, col: 4, value: 2 }]
    expect(isValidCore({ ...makeCore(5), tiles }, 5)).toBe(true)
    expect(isValidCore({ ...makeCore(4), tiles }, 4)).toBe(false)
  })

  it('拒绝缺字段或类型错误的数据', () => {
    expect(isValidCore(null, 4)).toBe(false)
    expect(isValidCore(undefined, 4)).toBe(false)
    expect(isValidCore('字符串', 4)).toBe(false)
    expect(isValidCore({}, 4)).toBe(false)
    expect(isValidCore({ ...makeCore(4), tiles: '不是数组' }, 4)).toBe(false)
    expect(isValidCore({ ...makeCore(4), score: NaN }, 4)).toBe(false)
    expect(isValidCore({ ...makeCore(4), score: '100' }, 4)).toBe(false)
  })

  it('拒绝数值非法的方块', () => {
    const bad = makeCore(4, { tiles: [{ id: 1, row: 0, col: 0, value: 1 }] })
    expect(isValidCore(bad, 4)).toBe(false)
  })
})

describe('存档按尺寸隔离', () => {
  it('两种尺寸使用不同的键，互不影响', () => {
    saveGame(4, { core: makeCore(4, { score: 44 }), history: [] })
    saveGame(5, { core: makeCore(5, { score: 55 }), history: [] })

    expect(loadSaved(4)!.core.score).toBe(44)
    expect(loadSaved(5)!.core.score).toBe(55)
    expect(localStorage.getItem(K4)).not.toBeNull()
    expect(localStorage.getItem(K5)).not.toBeNull()
  })

  it('只写 4×4 时读 5×5 返回 null', () => {
    saveGame(4, { core: makeCore(4), history: [] })
    expect(loadSaved(4)).not.toBeNull()
    expect(loadSaved(5)).toBeNull()
  })

  it('覆盖一个尺寸的存档不影响另一个', () => {
    saveGame(4, { core: makeCore(4, { score: 10 }), history: [] })
    saveGame(5, { core: makeCore(5, { score: 20 }), history: [] })
    saveGame(4, { core: makeCore(4, { score: 30 }), history: [] })

    expect(loadSaved(4)!.core.score).toBe(30)
    expect(loadSaved(5)!.core.score).toBe(20)
  })

  it('撤销栈随存档往返', () => {
    const history = [makeCore(5, { score: 1 }), makeCore(5, { score: 2 })]
    saveGame(5, { core: makeCore(5, { score: 3 }), history })
    expect(loadSaved(5)!.history.length).toBe(2)
    expect(loadSaved(5)!.history[0].score).toBe(1)
  })
})

describe('存档校验与容错', () => {
  it('尺寸不符的存档被拒绝', () => {
    // 往 5×5 的键里塞一份 4×4 的数据
    localStorage.setItem(K5, JSON.stringify({ core: makeCore(4), history: [] }))
    expect(loadSaved(5)).toBeNull()
  })

  it('坐标越界的存档被拒绝而非抛错', () => {
    const bad = makeCore(4, { tiles: [{ id: 1, row: 9, col: 0, value: 2 }] })
    localStorage.setItem(K4, JSON.stringify({ core: bad, history: [] }))
    expect(() => loadSaved(4)).not.toThrow()
    expect(loadSaved(4)).toBeNull()
  })

  it('损坏的 JSON 返回 null', () => {
    localStorage.setItem(K4, '{不是合法 JSON')
    expect(loadSaved(4)).toBeNull()
  })

  it('撤销栈里有尺寸不符的项时整个栈被丢弃，但 core 保留', () => {
    const saved = {
      core: makeCore(5, { score: 99 }),
      history: [makeCore(5), makeCore(4)], // 第二项尺寸不符
    }
    localStorage.setItem(K5, JSON.stringify(saved))
    const loaded = loadSaved(5)
    expect(loaded).not.toBeNull()
    expect(loaded!.core.score).toBe(99)
    expect(loaded!.history).toEqual([])
  })

  it('history 不是数组时按空栈处理', () => {
    localStorage.setItem(K4, JSON.stringify({ core: makeCore(4), history: '坏数据' }))
    expect(loadSaved(4)!.history).toEqual([])
  })
})

describe('v1 旧存档迁移', () => {
  /** v1 的 core 没有 size 字段 */
  function v1Core(score = 128) {
    return {
      tiles: [{ id: 1, row: 1, col: 2, value: 8 }],
      score,
      won: false,
      keepPlaying: false,
      over: false,
      nextId: 2,
    }
  }

  it('4×4 在新键缺失时读取 v1 并补上 size', () => {
    localStorage.setItem(V1_STATE, JSON.stringify({ core: v1Core(256), history: [] }))
    const loaded = loadSaved(4)
    expect(loaded).not.toBeNull()
    expect(loaded!.core.size).toBe(4)
    expect(loaded!.core.score).toBe(256)
  })

  it('5×5 不读取 v1 存档', () => {
    localStorage.setItem(V1_STATE, JSON.stringify({ core: v1Core(), history: [] }))
    expect(loadSaved(5)).toBeNull()
  })

  it('新键存在时优先使用新键，不再读 v1', () => {
    localStorage.setItem(V1_STATE, JSON.stringify({ core: v1Core(111), history: [] }))
    saveGame(4, { core: makeCore(4, { score: 222 }), history: [] })
    expect(loadSaved(4)!.core.score).toBe(222)
  })

  it('v1 的撤销栈也会被补上 size', () => {
    localStorage.setItem(
      V1_STATE,
      JSON.stringify({ core: v1Core(), history: [v1Core(64)] }),
    )
    const loaded = loadSaved(4)
    expect(loaded!.history.length).toBe(1)
    expect(loaded!.history[0].size).toBe(4)
  })

  it('v1 最高分只迁移给 4×4', () => {
    localStorage.setItem(V1_BEST, '2048')
    expect(loadBest(4)).toBe(2048)
    expect(loadBest(5)).toBe(0)
  })
})

describe('旧存档补默认字段（next / streak）', () => {
  /** 引入预告与连击之前的存档：有 size，但没有 next / streak */
  function preComboCore(score = 300) {
    return {
      size: 4,
      tiles: [{ id: 1, row: 0, col: 0, value: 8 }],
      score,
      won: false,
      keepPlaying: false,
      over: false,
      nextId: 2,
    }
  }

  it('缺 next / streak 的存档被补上默认值而不是丢弃', () => {
    localStorage.setItem(K4, JSON.stringify({ core: preComboCore(300), history: [] }))
    const loaded = loadSaved(4)
    expect(loaded).not.toBeNull()
    expect(loaded!.core.score).toBe(300)
    expect(loaded!.core.next).toBe(2)
    expect(loaded!.core.streak).toBe(0)
  })

  it('撤销栈里的旧条目同样被补齐，整栈不会因此被丢弃', () => {
    localStorage.setItem(
      K4,
      JSON.stringify({ core: preComboCore(), history: [preComboCore(100)] }),
    )
    const loaded = loadSaved(4)
    expect(loaded!.history.length).toBe(1)
    expect(loaded!.history[0].next).toBe(2)
    expect(loaded!.history[0].streak).toBe(0)
  })

  it('拒绝 next 非 2/4 的存档', () => {
    expect(isValidCore(makeCore(4, { next: 8 }), 4)).toBe(false)
    expect(isValidCore(makeCore(4, { next: Number.NaN }), 4)).toBe(false)
  })

  it('拒绝 streak 为负数或 NaN 的存档', () => {
    expect(isValidCore(makeCore(4, { streak: -1 }), 4)).toBe(false)
    expect(isValidCore(makeCore(4, { streak: Number.NaN }), 4)).toBe(false)
  })

  it('拒绝方块数值不是 2 的幂的存档（含 NaN）', () => {
    expect(
      isValidCore(makeCore(4, { tiles: [{ id: 1, row: 0, col: 0, value: 6 }] }), 4),
    ).toBe(false)
    expect(
      isValidCore(makeCore(4, { tiles: [{ id: 1, row: 0, col: 0, value: Number.NaN }] }), 4),
    ).toBe(false)
  })

  it('分数为 NaN 的存档被拒绝，避免污染最高分', () => {
    localStorage.setItem(
      K4,
      JSON.stringify({ core: { ...preComboCore(), score: null }, history: [] }),
    )
    expect(loadSaved(4)).toBeNull()
  })
})

describe('最高分', () => {
  it('按尺寸独立存取', () => {
    saveBest(4, 400)
    saveBest(5, 500)
    expect(loadBest(4)).toBe(400)
    expect(loadBest(5)).toBe(500)
  })

  it('未存过时为 0', () => {
    expect(loadBest(4)).toBe(0)
    expect(loadBest(5)).toBe(0)
  })

  it('非法值回退为 0', () => {
    localStorage.setItem('react-2048/best-v2-4x4', '不是数字')
    expect(loadBest(4)).toBe(0)
    localStorage.setItem('react-2048/best-v2-5x5', '-5')
    expect(loadBest(5)).toBe(0)
  })
})

describe('尺寸偏好', () => {
  it('默认为 4', () => {
    expect(loadSize()).toBe(4)
  })

  it('可存取', () => {
    saveSize(5)
    expect(loadSize()).toBe(5)
    saveSize(4)
    expect(loadSize()).toBe(4)
  })

  it('非法值回退为默认尺寸', () => {
    for (const bad of ['7', 'abc', '', '0', '4.5']) {
      localStorage.setItem('react-2048/size-v1', bad)
      expect(loadSize(), `"${bad}" 应回退`).toBe(4)
    }
  })
})

describe('localStorage 不可用时的降级', () => {
  it('读写抛错时不影响调用方', () => {
    const getItem = Storage.prototype.getItem
    const setItem = Storage.prototype.setItem
    Storage.prototype.getItem = () => {
      throw new Error('隐私模式')
    }
    Storage.prototype.setItem = () => {
      throw new Error('隐私模式')
    }
    try {
      expect(loadSaved(4)).toBeNull()
      expect(loadBest(4)).toBe(0)
      expect(loadSize()).toBe(4)
      expect(() => saveGame(4, { core: makeCore(4), history: [] })).not.toThrow()
      expect(() => saveBest(4, 10)).not.toThrow()
      expect(() => saveSize(5)).not.toThrow()
    } finally {
      Storage.prototype.getItem = getItem
      Storage.prototype.setItem = setItem
    }
  })
})
