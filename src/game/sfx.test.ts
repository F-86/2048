import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

/**
 * 音效模块测试。
 *
 * jsdom 没有 Web Audio，这里用最小可用的 AudioContext 假实现，
 * 记录被创建的节点与参数，从而验证：
 *  1. 无 Web Audio 时静默降级不抛错
 *  2. 各音效确实创建了振荡器并设置了合理的频率与包络
 *  3. 合并音高随数字单调递增
 *  4. 静音时主增益归零
 */

interface ParamCall {
  method: string
  args: number[]
}

/** 记录所有调用的 AudioParam 假实现 */
class FakeParam {
  value: number
  calls: ParamCall[] = []

  constructor(initial = 0) {
    this.value = initial
  }

  setValueAtTime(...args: number[]) {
    this.calls.push({ method: 'setValueAtTime', args })
    return this
  }

  linearRampToValueAtTime(...args: number[]) {
    this.calls.push({ method: 'linearRamp', args })
    return this
  }

  exponentialRampToValueAtTime(...args: number[]) {
    this.calls.push({ method: 'expRamp', args })
    return this
  }
}

interface FakeOsc {
  type: string
  frequency: FakeParam
  started: number[]
  stopped: number[]
}

interface Created {
  oscillators: FakeOsc[]
  gains: FakeParam[]
  buffers: number
  filters: string[]
}

let created: Created
let ctxState: string

function installFakeAudio() {
  created = { oscillators: [], gains: [], buffers: 0, filters: [] }
  ctxState = 'running'

  class FakeAudioContext {
    currentTime = 0
    sampleRate = 44100
    destination = {}
    get state() {
      return ctxState
    }
    resume = vi.fn(() => {
      ctxState = 'running'
      return Promise.resolve()
    })

    createOscillator() {
      const osc = {
        type: 'sine',
        frequency: new FakeParam(0),
        started: [] as number[],
        stopped: [] as number[],
        connect: () => undefined,
        start(t = 0) {
          this.started.push(t)
        },
        stop(t = 0) {
          this.stopped.push(t)
        },
      }
      created.oscillators.push(osc)
      return osc
    }

    createGain() {
      const gain = new FakeParam(1)
      created.gains.push(gain)
      return { gain, connect: () => undefined }
    }

    createBuffer(_ch: number, frames: number) {
      created.buffers++
      const data = new Float32Array(frames)
      return { getChannelData: () => data, length: frames }
    }

    createBufferSource() {
      return { buffer: null, connect: () => undefined, start: () => undefined }
    }

    createBiquadFilter() {
      const f = { type: 'lowpass', frequency: { value: 0 }, connect: () => undefined }
      created.filters.push(f.type)
      return f
    }
  }

  ;(globalThis as { AudioContext?: unknown }).AudioContext = FakeAudioContext
}

/** 每个用例都重新导入模块，避免模块内的 ctx 单例跨用例污染 */
async function freshSfx() {
  vi.resetModules()
  return await import('./sfx')
}

beforeEach(() => {
  installFakeAudio()
  localStorage.clear()
})

afterEach(() => {
  delete (globalThis as { AudioContext?: unknown }).AudioContext
  localStorage.clear()
})

describe('sfx — 基本发声', () => {
  it('move 创建振荡器与噪声脉冲', async () => {
    const { sfx } = await freshSfx()
    sfx.move()
    expect(created.oscillators.length).toBeGreaterThanOrEqual(1)
    // 噪声脉冲用到 buffer 与低通滤波
    expect(created.buffers).toBe(1)
    expect(created.filters).toContain('lowpass')
  })

  it('每个音效都会创建至少一个振荡器', async () => {
    const { sfx } = await freshSfx()
    const cases: Array<[string, () => void]> = [
      ['move', () => sfx.move()],
      ['merge', () => sfx.merge(8)],
      ['combo', () => sfx.combo(8, 3)],
      ['danger', () => sfx.danger()],
      ['record', () => sfx.record()],
      ['win', () => sfx.win()],
      ['over', () => sfx.over()],
      ['undo', () => sfx.undo()],
      ['restart', () => sfx.restart()],
    ]
    for (const [name, play] of cases) {
      created.oscillators.length = 0
      play()
      expect(created.oscillators.length, `${name} 应创建振荡器`).toBeGreaterThan(0)
    }
  })

  it('振荡器都被启动且设定了停止时间', async () => {
    const { sfx } = await freshSfx()
    sfx.merge(16)
    for (const osc of created.oscillators) {
      expect(osc.started.length).toBe(1)
      expect(osc.stopped.length).toBe(1)
      // 停止时间必须晚于开始时间
      expect(osc.stopped[0]).toBeGreaterThan(osc.started[0])
    }
  })

  it('包络有淡入与衰减，避免爆音', async () => {
    const { sfx } = await freshSfx()
    sfx.undo()
    // 除主增益外，音符包络应包含 setValueAtTime + linearRamp + expRamp
    const envelopes = created.gains.filter((g) => g.calls.length >= 3)
    expect(envelopes.length).toBeGreaterThan(0)
    const methods = envelopes[0].calls.map((c) => c.method)
    expect(methods).toContain('setValueAtTime')
    expect(methods).toContain('linearRamp')
    expect(methods).toContain('expRamp')
  })
})

describe('sfx — 合并音高', () => {
  it('音高随合成数字单调递增', async () => {
    const { sfx } = await freshSfx()
    const values = [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]
    const pitches: number[] = []

    for (const v of values) {
      created.oscillators.length = 0
      sfx.merge(v)
      // 取基频（第一个振荡器），第二个是高八度泛音
      const base = created.oscillators[0].frequency.calls.find(
        (c) => c.method === 'setValueAtTime',
      )
      expect(base).toBeDefined()
      pitches.push(base!.args[0])
    }

    for (let i = 1; i < pitches.length; i++) {
      expect(pitches[i], `${values[i]} 的音高应高于 ${values[i - 1]}`).toBeGreaterThan(pitches[i - 1])
    }
  })

  it('音高落在可听范围内', async () => {
    const { sfx } = await freshSfx()
    for (const v of [4, 64, 2048, 65536]) {
      created.oscillators.length = 0
      sfx.merge(v)
      for (const osc of created.oscillators) {
        const set = osc.frequency.calls.find((c) => c.method === 'setValueAtTime')
        if (set) {
          expect(set.args[0]).toBeGreaterThan(50)
          expect(set.args[0]).toBeLessThan(12000)
        }
      }
    }
  })

  it('合并会叠加泛音（两个振荡器）', async () => {
    const { sfx } = await freshSfx()
    sfx.merge(32)
    expect(created.oscillators.length).toBe(2)
    const f0 = created.oscillators[0].frequency.calls[0].args[0]
    const f1 = created.oscillators[1].frequency.calls[0].args[0]
    // 第二个是第一个的高八度
    expect(f1 / f0).toBeCloseTo(2, 1)
  })
})

describe('sfx — 多音音效', () => {
  it('胜利音是 4 个音的琶音，依次延迟', async () => {
    const { sfx } = await freshSfx()
    sfx.win()
    expect(created.oscillators.length).toBe(4)
    const starts = created.oscillators.map((o) => o.started[0])
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]).toBeGreaterThan(starts[i - 1])
    }
  })

  it('结束音为下行两音', async () => {
    const { sfx } = await freshSfx()
    sfx.over()
    expect(created.oscillators.length).toBe(2)
    const f0 = created.oscillators[0].frequency.calls[0].args[0]
    const f1 = created.oscillators[1].frequency.calls[0].args[0]
    expect(f1).toBeLessThan(f0)
  })

  it('撤销音为下滑音', async () => {
    const { sfx } = await freshSfx()
    sfx.undo()
    const osc = created.oscillators[0]
    const start = osc.frequency.calls.find((c) => c.method === 'setValueAtTime')!.args[0]
    const glide = osc.frequency.calls.find((c) => c.method === 'expRamp')!.args[0]
    expect(glide).toBeLessThan(start)
  })

  it('新游戏音为上行两音', async () => {
    const { sfx } = await freshSfx()
    sfx.restart()
    expect(created.oscillators.length).toBe(2)
    const f0 = created.oscillators[0].frequency.calls[0].args[0]
    const f1 = created.oscillators[1].frequency.calls[0].args[0]
    expect(f1).toBeGreaterThan(f0)
  })

  it('连锁音是上行琶音，音数随合并对数增加', async () => {
    const { sfx } = await freshSfx()
    sfx.combo(8, 2)
    const two = created.oscillators.length
    created.oscillators.length = 0
    sfx.combo(8, 4)
    expect(created.oscillators.length).toBeGreaterThan(two)

    // 音高逐级上行，起音时间依次延后
    const freqs = created.oscillators.map((o) => o.frequency.calls[0].args[0])
    const starts = created.oscillators.map((o) => o.started[0])
    for (let i = 1; i < freqs.length; i++) {
      expect(freqs[i]).toBeGreaterThan(freqs[i - 1])
      expect(starts[i]).toBeGreaterThan(starts[i - 1])
    }
  })

  it('连锁音的音数有上限，超长连锁不会无限爬高', async () => {
    const { sfx } = await freshSfx()
    sfx.combo(8, 99)
    expect(created.oscillators.length).toBeLessThanOrEqual(4)
  })

  it('危险音是两声低频心跳', async () => {
    const { sfx } = await freshSfx()
    sfx.danger()
    expect(created.oscillators.length).toBe(2)
    for (const osc of created.oscillators) {
      const freq = osc.frequency.calls[0].args[0]
      // 心跳要低沉，压在 120Hz 以下
      expect(freq).toBeLessThan(120)
    }
    // 第二声晚于第一声
    expect(created.oscillators[1].started[0]).toBeGreaterThan(created.oscillators[0].started[0])
  })

  it('破纪录音是上行三音', async () => {
    const { sfx } = await freshSfx()
    sfx.record()
    expect(created.oscillators.length).toBe(3)
    const freqs = created.oscillators.map((o) => o.frequency.calls[0].args[0])
    for (let i = 1; i < freqs.length; i++) {
      expect(freqs[i]).toBeGreaterThan(freqs[i - 1])
    }
  })
})

describe('sfx — 静音与偏好', () => {
  it('静音时主增益归零，取消静音后恢复', async () => {
    const { sfx, applyMuted } = await freshSfx()
    sfx.move() // 先创建 context
    const masterGain = created.gains[0]

    applyMuted(true)
    expect(masterGain.value).toBe(0)

    applyMuted(false)
    expect(masterGain.value).toBeGreaterThan(0)
  })

  it('静音偏好可存取', async () => {
    const { loadMuted, saveMuted } = await freshSfx()
    expect(loadMuted()).toBe(false)
    saveMuted(true)
    expect(loadMuted()).toBe(true)
    saveMuted(false)
    expect(loadMuted()).toBe(false)
  })

  it('suspended 状态下播放会尝试恢复 context', async () => {
    const { sfx } = await freshSfx()
    sfx.move()
    ctxState = 'suspended'
    // 不应抛错，且会调用 resume
    expect(() => sfx.merge(8)).not.toThrow()
    expect(ctxState).toBe('running')
  })
})

describe('sfx — 降级处理', () => {
  it('完全没有 Web Audio 时所有音效静默不抛错', async () => {
    delete (globalThis as { AudioContext?: unknown }).AudioContext
    const { sfx, applyMuted } = await freshSfx()
    expect(() => {
      sfx.move()
      sfx.merge(4)
      sfx.win()
      sfx.over()
      sfx.undo()
      sfx.restart()
      applyMuted(true)
      applyMuted(false)
    }).not.toThrow()
  })

  it('AudioContext 构造抛错时也不影响游戏', async () => {
    ;(globalThis as { AudioContext?: unknown }).AudioContext = class {
      constructor() {
        throw new Error('模拟音频初始化失败')
      }
    }
    const { sfx } = await freshSfx()
    expect(() => sfx.move()).not.toThrow()
    expect(() => sfx.merge(1024)).not.toThrow()
  })

  it('localStorage 不可用时静音偏好读写不抛错', async () => {
    const orig = Storage.prototype.getItem
    const origSet = Storage.prototype.setItem
    Storage.prototype.getItem = () => { throw new Error('隐私模式') }
    Storage.prototype.setItem = () => { throw new Error('隐私模式') }
    try {
      const { loadMuted, saveMuted } = await freshSfx()
      expect(loadMuted()).toBe(false)
      expect(() => saveMuted(true)).not.toThrow()
    } finally {
      Storage.prototype.getItem = orig
      Storage.prototype.setItem = origSet
    }
  })
})
