import type { DvpSnapshot, MarketSnapshot } from '../../shared/market'

let market: Promise<MarketSnapshot> | null = null
let dvp: Promise<DvpSnapshot | null> | null = null

async function getJson<T>(url: string): Promise<T> {
  // A hung request should fail (and be retried), not spin forever.
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
  const ct = r.headers.get('content-type') ?? ''
  if (!r.ok || !ct.includes('json')) throw new Error(`${url} unavailable (${r.status})`)
  return r.json() as Promise<T>
}

/** Books + ESPN for the priced week, and DvP tables. DvP is optional: the Blend still works without it. */
export function loadBlendFeeds(): Promise<[MarketSnapshot, DvpSnapshot | null]> {
  market ??= getJson<MarketSnapshot>('/api/market').catch((e) => {
    market = null
    throw e
  })
  dvp ??= getJson<DvpSnapshot>('/api/dvp').catch(() => {
    dvp = null
    return null
  })
  return Promise.all([market, dvp])
}
