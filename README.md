# 2048

网页版 2048 游戏，使用 React 19 + TypeScript + Vite 开发。

## 快速开始

```bash
npm install     # 安装依赖
npm run dev     # 启动开发服务器 → http://localhost:5173
```

## 可用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动开发服务器（热更新） |
| `npm run build` | 类型检查 + 生产构建，输出到 `dist/` |
| `npm run preview` | 本地预览生产构建产物 |
| `npm test` | 监听模式运行测试 |
| `npm run test:run` | 单次运行全部测试 |
| `npm run typecheck` | 仅做类型检查 |

## 玩法

用方向键或滑动屏幕移动所有方块，两个相同数字相撞会合并成它们的和。每次移动后棋盘会随机出现一个新方块（90% 是 2，10% 是 4）。凑出 **2048** 即获胜，之后可以选择继续挑战更高分。棋盘填满且无法再合并时游戏结束。

### 操作方式

| 操作 | 按键 |
| --- | --- |
| 移动 | 方向键 / `WASD` / `HJKL` |
| 撤销 | `Z` 或「撤销」按钮（最多回退 20 步） |
| 静音 | `M` 或 🔊 按钮 |
| 重开 | 「新游戏」按钮 |
| 移动端 | 在棋盘上滑动 |

对局进度、最高分与静音偏好会自动保存在浏览器 `localStorage`，关闭页面后仍可继续。

## 音效

所有音效用 Web Audio 实时合成，不加载任何音频文件（零体积、无版权问题）。风格偏克制轻柔：音量压低、衰减快，长时间游戏不吵。

合并音的音高随合成的数字升高，走五声音阶以保证任意组合都不刺耳：

| 数字 | 4 | 16 | 64 | 256 | 1024 | 2048 |
| --- | --- | --- | --- | --- | --- | --- |
| 音高 | C4 | E4 | A4 | D5 | G5 | A5 |

此外滑动、撤销、新游戏、胜利、失败各有对应音效。首次交互后才会创建 `AudioContext`（遵循浏览器自动播放策略）；环境不支持 Web Audio 时静默降级为无声，不影响游戏。

## 项目结构

```
public/                 图标与 PWA manifest
scripts/
└── resize-icon.mjs     纯 Node 实现的 PNG 缩放（生成各尺寸图标用）
src/
├── game/
│   ├── types.ts        游戏类型定义与常量
│   ├── engine.ts       核心逻辑：移动、合并、生成、胜负判定（纯函数）
│   ├── engine.test.ts  引擎单元测试
│   ├── sfx.ts          Web Audio 音效合成
│   ├── sfx.test.ts     音效测试
│   ├── useGame.ts      React 状态管理：撤销栈、localStorage 持久化、音效触发
│   └── useInput.ts     键盘与触摸滑动输入
├── components/
│   ├── Board.tsx       棋盘与胜负遮罩
│   ├── Tile.tsx        单个方块与背景格
│   └── ScoreBoard.tsx  分数面板与得分飘字
├── App.tsx             页面组装
├── App.test.tsx        组件与交互测试
├── styles.css          全部样式与动画
└── main.tsx            入口
```

## 实现说明

**游戏逻辑与渲染分离。** `engine.ts` 是不依赖 React 的纯函数，输入状态输出新状态，随机数发生器通过参数注入，因此测试可以完全复现。所有规则细节（同一方块一次移动内不能二次合并、合并优先级从移动方向的墙壁侧开始）都有对应测试覆盖。

**动画依靠稳定的方块 id。** 每个方块有一个不变的 `id` 作为 React key，位置通过 CSS 变量 `--row` / `--col` 转成 `transform: translate(...)`。位置变化时由 CSS transition 产生滑动效果，而不是重新创建节点。

**合并的视觉处理。** 两块相撞时，被撞的那块保留 id 并翻倍（播放弹出动画），撞过去的那块滑到同一格后标记为「残影」并淡出，在下一回合被清除。这样两个方块都有真实的位移轨迹，看起来就是滑过去再合并。

**方块按 id 排序渲染。** 保证 DOM 顺序稳定，避免 React 重排节点时打断正在进行的 CSS transition；层叠关系交给 `z-index` 控制。

**reducer 保持纯函数。** 随机数在 reducer 外取好经 action 传入，音效也不在 reducer 内播放——reducer 只在 state 里记录「该播什么音」的描述符，由 effect 消费。这样 StrictMode 下 reducer 被重复执行时结果一致，也不会重复发声。

## 测试

```bash
npm run test:run
```

覆盖三个层面：`engine.test.ts` 验证游戏规则与不变量（含随机对局的模糊测试，检查坐标不越界、无重叠方块、分数自洽、数值均为 2 的幂）；`sfx.test.ts` 用假的 `AudioContext` 验证音效确实创建了振荡器、音高单调递增、包络有淡入淡出、静音真的归零，以及无 Web Audio 时的降级；`App.test.tsx` 在 jsdom 中渲染真实组件，验证键盘操作、触摸滑动、撤销、重开、静音开关以及 localStorage 持久化与存档损坏时的回退。
