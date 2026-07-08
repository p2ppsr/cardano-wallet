import { formatAdaWithUnit, KOIOS_API_BASE } from './cardano'

const KOIOS_TOKEN = import.meta.env.VITE_KOIOS_TOKEN?.trim()

export interface AddressTxRef {
  txHash: string
  blockHeight: number
  blockTime?: number
  epoch?: number
}

export interface AddressState {
  address: string
  balance: bigint
  pendingBalance: bigint
  utxoCount: number
  txCount: number
  txrefs: AddressTxRef[]
  tipHeight?: number
  raw: unknown
}

interface KoiosTip {
  block_height?: number
  block_no?: number
  block_time?: number
  epoch_no?: number
}

const withAuth = (headers: HeadersInit = {}): HeadersInit => {
  if (!KOIOS_TOKEN) return headers
  return { ...headers, authorization: `Bearer ${KOIOS_TOKEN}` }
}

const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(`${KOIOS_API_BASE}${path}`, {
    method: 'POST',
    headers: withAuth({ 'content-type': 'application/json' }),
    body: JSON.stringify(body)
  })
  const text = await response.text()
  let data: unknown
  try {
    data = text.length > 0 ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'message' in data
        ? String((data as { message: unknown }).message)
        : text || response.statusText
    throw new Error(`Koios ${response.status}: ${message}`)
  }
  return data as T
}

const getJson = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${KOIOS_API_BASE}${path}`, { headers: withAuth() })
  const text = await response.text()
  let data: unknown
  try {
    data = text.length > 0 ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!response.ok) throw new Error(`Koios ${response.status}: ${text || response.statusText}`)
  return data as T
}

const toBigint = (value: unknown): bigint => {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value))
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  return 0n
}

const txHashOf = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    const ref = value as Record<string, unknown>
    return String(ref.tx_hash ?? ref.txHash ?? ref.hash ?? '')
  }
  return ''
}

export const fetchTip = async (): Promise<KoiosTip | null> => {
  const tips = await getJson<KoiosTip[]>('/tip')
  return Array.isArray(tips) && tips.length > 0 ? tips[0] : null
}

export const fetchAddressState = async (address: string): Promise<AddressState> => {
  const [utxos, txs, tip] = await Promise.all([
    postJson<any[]>('/address_utxos', { _addresses: [address] }),
    postJson<any[]>('/address_txs', { _addresses: [address], _after_block_height: 0 }),
    fetchTip().catch(() => null)
  ])

  const balance = Array.isArray(utxos)
    ? utxos.reduce((sum, utxo) => sum + toBigint(utxo.value), 0n)
    : 0n

  const refs = Array.isArray(txs)
    ? txs
      .map(tx => ({
        txHash: txHashOf(tx.tx_hash ?? tx.hash ?? tx),
        blockHeight: Number(tx.block_height ?? tx.block_no ?? 0),
        blockTime: typeof tx.block_time === 'number' ? tx.block_time : undefined,
        epoch: typeof tx.epoch_no === 'number' ? tx.epoch_no : undefined
      }))
      .filter(tx => tx.txHash.length > 0)
      .sort((left, right) => right.blockHeight - left.blockHeight)
    : []

  return {
    address,
    balance,
    pendingBalance: 0n,
    utxoCount: Array.isArray(utxos) ? utxos.length : 0,
    txCount: refs.length,
    txrefs: refs,
    tipHeight: tip?.block_height ?? tip?.block_no,
    raw: { utxos, txs, tip }
  }
}

export const cardanoExplorerTxUrl = (txHash: string): string => {
  return `https://cardanoscan.io/transaction/${txHash}`
}

export const cardanoExplorerAddressUrl = (address: string): string => {
  return `https://cardanoscan.io/address/${address}`
}

export const formatAdaExplorerValue = (value: bigint): string => formatAdaWithUnit(value, 4)

export const subscribeToAddress = (
  address: string,
  handlers: {
    onStatus?: (status: 'connecting' | 'open' | 'closed' | 'error') => void
    onTransaction?: (event: unknown) => void
  }
): (() => void) => {
  let closed = false
  let timer: number | undefined
  let latestTx: string | null = null

  const poll = async () => {
    if (closed) return
    handlers.onStatus?.(latestTx == null ? 'connecting' : 'open')
    try {
      const state = await fetchAddressState(address)
      const nextLatest = state.txrefs[0]?.txHash ?? null
      if (latestTx != null && nextLatest != null && nextLatest !== latestTx) {
        handlers.onTransaction?.(state.txrefs[0])
      }
      latestTx = nextLatest
      handlers.onStatus?.('open')
    } catch (error) {
      handlers.onStatus?.('error')
    } finally {
      if (!closed) timer = window.setTimeout(poll, 30000)
    }
  }

  poll()
  return () => {
    closed = true
    if (timer !== undefined) window.clearTimeout(timer)
    handlers.onStatus?.('closed')
  }
}
