// Per-instance memory cache. Every upstream is free, so memory + the CDN's
// s-maxage is enough: a cold instance just refetches.

const mem = new Map<string, { at: number; value: unknown }>()
const inflight = new Map<string, Promise<unknown>>()

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = mem.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value as T)
  const running = inflight.get(key) as Promise<T> | undefined
  if (running) return running
  const p = fn()
    .then((value) => {
      mem.set(key, { at: Date.now(), value })
      return value
    })
    .catch((e) => {
      // Serve the last good value rather than nothing when an upstream flakes.
      if (hit) return hit.value as T
      throw e
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`)
  return (await r.json()) as T
}

/** American odds -> implied probability (with vig). */
export const implied = (american: number) =>
  american < 0 ? -american / (-american + 100) : 100 / (american + 100)
