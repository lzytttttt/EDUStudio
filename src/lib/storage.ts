import { getDataProvider } from './dataProvider'

const NS = 'edustudio:'

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = getDataProvider().getItem(NS + key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch (err) {
    console.error('[storage] load failed:', key, err)
    return fallback
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    getDataProvider().setItem(NS + key, JSON.stringify(value))
  } catch (err) {
    console.error('[storage] save failed:', key, err)
  }
}

export function removeKey(key: string): void {
  try {
    getDataProvider().removeItem(NS + key)
  } catch (err) {
    console.error('[storage] remove failed:', key, err)
  }
}

export function clearAll(): void {
  try {
    const keys = getDataProvider()
      .keys()
      .filter((k) => k.startsWith(NS))
    keys.forEach((k) => getDataProvider().removeItem(k))
  } catch (err) {
    console.error('[storage] clear failed:', err)
  }
}
