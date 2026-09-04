const NS = 'edustudio:'

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(NS + key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch (err) {
    console.error('[storage] load failed:', key, err)
    return fallback
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value))
  } catch (err) {
    console.error('[storage] save failed:', key, err)
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(NS + key)
  } catch (err) {
    console.error('[storage] remove failed:', key, err)
  }
}

export function clearAll(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(NS)) keys.push(k)
    }
    keys.forEach((k) => localStorage.removeItem(k))
  } catch (err) {
    console.error('[storage] clear failed:', err)
  }
}
