/**
 * 音效合成。
 *
 * 全部用 Web Audio 实时生成，不加载任何音频文件（零体积、无版权问题）。
 * 风格取向：克制轻柔——短促、低音量、快速衰减，长时间游戏不会吵。
 */

const STORAGE_KEY = 'react-2048/muted-v1'

/** 主音量上限，刻意压低以保证「轻柔」 */
const MASTER_GAIN = 0.22

/** 五声音阶（C 大调去掉四度七度）：任意组合都不刺耳，适合随机音高 */
const PENTATONIC = [0, 2, 4, 7, 9]

let ctx: AudioContext | null = null
let master: GainNode | null = null

/** 浏览器要求用户手势后才能启动音频，故延迟创建 */
function ensureContext(): AudioContext | null {
  if (ctx) return ctx
  try {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
    master = ctx.createGain()
    master.gain.value = MASTER_GAIN
    master.connect(ctx.destination)
  } catch {
    // 不支持 Web Audio 时静默降级为无声
    return null
  }
  return ctx
}

/** 自动播放策略可能让 context 处于 suspended，需在手势中恢复 */
function resume() {
  if (ctx?.state === 'suspended') void ctx.resume()
}

/** 半音数转频率，以 A4 = 440Hz 为基准 */
function noteToFreq(semitonesFromA4: number): number {
  return 440 * Math.pow(2, semitonesFromA4 / 12)
}

interface ToneOptions {
  freq: number
  /** 时长（秒） */
  duration: number
  type?: OscillatorType
  /** 相对主音量的比例 */
  gain?: number
  /** 相对当前时刻的延迟（秒） */
  delay?: number
  /** 频率滑动到的目标值，用于「啾」的效果 */
  glideTo?: number
}

/** 播放单个音：正弦/三角波 + 指数衰减包络，听感柔和无爆音 */
function tone({ freq, duration, type = 'sine', gain = 1, delay = 0, glideTo }: ToneOptions) {
  const audio = ensureContext()
  if (!audio || !master) return

  const start = audio.currentTime + delay
  const osc = audio.createOscillator()
  const env = audio.createGain()

  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (glideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), start + duration)
  }

  // 5ms 淡入避免爆音，随后指数衰减到近零
  env.gain.setValueAtTime(0, start)
  env.gain.linearRampToValueAtTime(gain, start + 0.005)
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration)

  osc.connect(env)
  env.connect(master)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

/** 轻噪声脉冲，给移动声添加一点「摩擦」质感 */
function noiseTick(gain = 0.1, duration = 0.045) {
  const audio = ensureContext()
  if (!audio || !master) return

  const frames = Math.floor(audio.sampleRate * duration)
  const buffer = audio.createBuffer(1, frames, audio.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) {
    // 线性衰减的白噪声
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
  }

  const src = audio.createBufferSource()
  src.buffer = buffer

  // 低通滤掉高频毛刺，只留下沉闷的一声
  const filter = audio.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 900

  const env = audio.createGain()
  env.gain.value = gain

  src.connect(filter)
  filter.connect(env)
  env.connect(master)
  src.start()
}

/** 把合成出的数字映射到五声音阶上的半音数（4 → 第 0 级，8 → 第 1 级，依此类推） */
function valueToSemitone(value: number): number {
  const step = Math.max(0, Math.round(Math.log2(value)) - 2)
  const octave = Math.floor(step / PENTATONIC.length)
  return PENTATONIC[step % PENTATONIC.length] + octave * 12
}

export const sfx = {
  /** 方块滑动：很轻的一声闷响，不抢戏 */
  move() {
    resume()
    noiseTick(0.09, 0.05)
    tone({ freq: 180, duration: 0.07, type: 'sine', gain: 0.16, glideTo: 130 })
  },

  /**
   * 合并：音高随合成的数字升高，制造进阶感。
   * 4 → 音阶第 0 级，8 → 第 1 级，依此类推，超出后按八度循环。
   */
  merge(value: number) {
    resume()
    const freq = noteToFreq(valueToSemitone(value) - 9) // 以 C4 附近起音

    tone({ freq, duration: 0.2, type: 'triangle', gain: 0.5 })
    // 叠加高八度泛音，让合并声更明亮清脆
    tone({ freq: freq * 2, duration: 0.14, type: 'sine', gain: 0.18, delay: 0.01 })
  },

  /**
   * 连锁：一次移动合并多对时播放上行琶音，对数越多音阶爬得越高。
   * 用五声音阶逐级向上，保证任意长度都不刺耳。
   */
  combo(value: number, count: number) {
    resume()
    const baseStep = Math.max(0, Math.round(Math.log2(value)) - 2)
    // 最多爬 4 级，避免超长连锁把音高推到刺耳的区间
    const steps = Math.min(Math.max(count, 2), 4)

    for (let i = 0; i < steps; i++) {
      const step = baseStep + i
      const octave = Math.floor(step / PENTATONIC.length)
      const semitone = PENTATONIC[step % PENTATONIC.length] + octave * 12
      tone({
        freq: noteToFreq(semitone - 9),
        duration: 0.22,
        type: 'triangle',
        // 后面的音略轻，听感是「一串」而不是「一堆」
        gain: 0.46 - i * 0.05,
        delay: i * 0.06,
      })
    }
  },

  /** 胜利：上行的小琶音 */
  win() {
    resume()
    const notes = [0, 4, 7, 12]
    notes.forEach((semi, i) => {
      tone({
        freq: noteToFreq(semi - 9),
        duration: 0.34,
        type: 'triangle',
        gain: 0.42,
        delay: i * 0.11,
      })
    })
  },

  /** 危险：两声低频闷响，像心跳，提示空格快用完了 */
  danger() {
    resume()
    const beat = (delay: number, gain: number) => {
      noiseTick(0.05, 0.05)
      tone({ freq: 92, duration: 0.17, type: 'sine', gain, delay, glideTo: 62 })
    }
    beat(0, 0.5)
    beat(0.22, 0.34)
  },

  /** 破纪录：短促的上行三音，比胜利音轻，不打断节奏 */
  record() {
    resume()
    ;[0, 4, 9].forEach((semi, i) => {
      tone({
        freq: noteToFreq(semi),
        duration: 0.18,
        type: 'triangle',
        gain: 0.34,
        delay: i * 0.05,
      })
    })
  },

  /** 游戏结束：下行的两个音，收尾略长 */
  over() {
    resume()
    tone({ freq: noteToFreq(-2), duration: 0.3, type: 'sine', gain: 0.4 })
    tone({ freq: noteToFreq(-9), duration: 0.5, type: 'sine', gain: 0.4, delay: 0.16 })
  },

  /** 撤销：频率下滑，听感像「倒回去」 */
  undo() {
    resume()
    tone({ freq: 420, duration: 0.16, type: 'sine', gain: 0.3, glideTo: 240 })
  },

  /** 新游戏：短促上扬的提示音 */
  restart() {
    resume()
    tone({ freq: 330, duration: 0.1, type: 'triangle', gain: 0.3 })
    tone({ freq: 495, duration: 0.16, type: 'triangle', gain: 0.3, delay: 0.07 })
  },
}

/** 读取静音偏好（默认开启声音） */
export function loadMuted(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** 保存静音偏好 */
export function saveMuted(muted: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0')
  } catch {
    // 隐私模式下不可写，忽略
  }
}

/** 静音时把主增益归零，而非销毁 context（避免反复创建） */
export function applyMuted(muted: boolean) {
  if (!muted) {
    // 取消静音时才需要初始化，避免页面加载就创建 AudioContext
    const audio = ensureContext()
    if (!audio || !master) return
    resume()
  }
  if (master) {
    master.gain.value = muted ? 0 : MASTER_GAIN
  }
}
