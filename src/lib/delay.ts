/** 可中断延迟；signal 触发 abort 时立即结束 */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 随机区间延迟，模拟真实网络/模型节奏 */
export function jitterDelay(min: number, max: number, signal?: AbortSignal): Promise<void> {
  return delay(min + Math.random() * (max - min), signal)
}
