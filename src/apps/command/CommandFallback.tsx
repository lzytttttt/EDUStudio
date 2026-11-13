/**
 * 总指挥工作区占位骨架（v1.2 M1-B）
 *
 * SurfaceHost 的 Suspense fallback：三视图按 `?view=` 懒加载，切换瞬间给同一套
 * 「柔和呼吸点」骨架（与 App.tsx 的 LazyFallback、旧 Director 的加载态一致），
 * 避免白闪；读屏只播报一句「加载中」。
 */

export default function CommandFallback(): JSX.Element {
  return (
    <div data-testid="command-fallback" className="flex h-full flex-col items-center justify-center gap-4">
      <div className="flex items-center gap-2" aria-hidden>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary/50"
            style={{ animationDelay: `${i * 0.12}s`, animationDuration: '1.2s' }}
          />
        ))}
      </div>
      <span className="sr-only" role="status">
        加载中
      </span>
    </div>
  )
}
