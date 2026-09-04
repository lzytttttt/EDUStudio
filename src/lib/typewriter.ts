import { jitterDelay } from './delay'

export interface TypewriterOptions {
  minChunk?: number
  maxChunk?: number
  minDelay?: number
  maxDelay?: number
  signal?: AbortSignal
}

/** 将整段文本按可变块切分逐块产出，模拟 token 流 */
export async function* typewriter(text: string, opts: TypewriterOptions = {}) {
  const minChunk = opts.minChunk ?? 2
  const maxChunk = opts.maxChunk ?? 6
  const minDelay = opts.minDelay ?? 12
  const maxDelay = opts.maxDelay ?? 36
  let i = 0
  while (i < text.length) {
    const size = Math.min(
      minChunk + Math.floor(Math.random() * (maxChunk - minChunk + 1)),
      text.length - i,
    )
    yield text.slice(i, i + size)
    i += size
    await jitterDelay(minDelay, maxDelay, opts.signal)
  }
}
