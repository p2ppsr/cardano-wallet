import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import BabbageGo from '@babbage/go'
import { WalletClient, type WalletInterface } from '@bsv/sdk'
import { QRCodeSVG } from 'qrcode.react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  Volume2,
  VolumeX,
  Wallet
} from 'lucide-react'
import {
  buildCardanoSendPreview,
  ensureCardanoIdentity,
  formatAdaWithUnit,
  parseAdaToLovelace,
  signAndSubmitCardano,
  truncateMiddle,
  type CardanoIdentity,
  type CardanoSendPreview
} from './cardano'
import {
  cardanoExplorerAddressUrl,
  cardanoExplorerTxUrl,
  fetchAddressState,
  subscribeToAddress,
  type AddressState
} from './koios'
import { playSfx } from './sfx'

type Mode = 'send' | 'receive'
type StatusKind = 'info' | 'success' | 'error'
type LiveStatus = 'connecting' | 'open' | 'closed' | 'error' | 'idle'

interface StatusMessage {
  kind: StatusKind
  text: string
}

interface SendFormState {
  to: string
  amount: string
}

const initialSendForm: SendFormState = {
  to: '',
  amount: ''
}

const getLiveLabel = (status: LiveStatus): string => {
  switch (status) {
    case 'open':
      return 'Live'
    case 'connecting':
      return 'Syncing'
    case 'error':
      return 'Koios issue'
    case 'closed':
      return 'Paused'
    default:
      return 'Idle'
  }
}

const epochTimestamp = (seconds?: number): string => {
  if (seconds == null || !Number.isFinite(seconds)) return 'pending'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    .format(new Date(seconds * 1000))
}

const userFacingError = (error: unknown, fallback: string): string => {
  const message = error instanceof Error ? error.message : ''
  if (/koios|transport error|failed to fetch|load failed|epoch_params|address_utxos|address_txs|api\/koios/i.test(message)) {
    return 'Cardano explorer sync is temporarily unavailable. Your sealed vault and ADA address are still usable.'
  }
  return message || fallback
}

export default function App() {
  const walletRef = useRef<WalletInterface | null>(null)
  const [identity, setIdentity] = useState<CardanoIdentity | null>(null)
  const [addressState, setAddressState] = useState<AddressState | null>(null)
  const [mode, setMode] = useState<Mode>('send')
  const [sendForm, setSendForm] = useState<SendFormState>(initialSendForm)
  const [sendPreview, setSendPreview] = useState<CardanoSendPreview | null>(null)
  const [status, setStatus] = useState<StatusMessage>({
    kind: 'info',
    text: 'Connect your Metanet wallet to unlock or create a sealed Cardano vault.'
  })
  const [isConnecting, setIsConnecting] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isReviewing, setIsReviewing] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('idle')
  const [lastBroadcastTxid, setLastBroadcastTxid] = useState<string | null>(null)
  const [showAddress, setShowAddress] = useState(true)
  const [sfxEnabled, setSfxEnabled] = useState(() => window.localStorage.getItem('cardano-wallet:sfx') !== 'off')

  const wallet = useCallback(() => {
    if (walletRef.current == null) {
      walletRef.current = new BabbageGo(new WalletClient(), {
        showModal: true,
        design: {
          preset: 'emberLagoon',
          tokens: {
            accentBackground: '#58d7ff',
            accentText: '#061526',
            accentHoverBackground: '#d6f5ff',
            accentHoverText: '#061526',
            buttonShape: 'soft',
            cardRadius: '8px'
          }
        },
        walletUnavailable: {
          title: 'Metanet wallet needed',
          message: 'Open this app in Metanet Explorer or install a BRC100 wallet to seal your Cardano vault.',
          ctaText: 'Open GetMetanet',
          ctaHref: 'https://getmetanet.com/open'
        }
      }) as WalletInterface
    }
    return walletRef.current
  }, [])

  const balance = addressState?.balance ?? 0n

  const syncAddress = useCallback(async (address: string, playSound = false) => {
    setIsRefreshing(true)
    try {
      const state = await fetchAddressState(address)
      setAddressState(state)
      setStatus({
        kind: 'success',
        text: `Synced ${state.txCount} Cardano transaction${state.txCount === 1 ? '' : 's'} at tip ${state.tipHeight ?? 'latest'}.`
      })
      if (playSound) playSfx('refresh', sfxEnabled)
    } catch (error) {
      setStatus({
        kind: 'error',
        text: userFacingError(error, 'Failed to sync Cardano explorer data.')
      })
      playSfx('error', sfxEnabled)
    } finally {
      setIsRefreshing(false)
    }
  }, [sfxEnabled])

  const connect = async () => {
    setIsConnecting(true)
    setStatus({ kind: 'info', text: 'Opening the BRC100-sealed Cardano vault...' })
    try {
      const nextIdentity = await ensureCardanoIdentity(wallet())
      setIdentity(nextIdentity)
      setStatus({
        kind: 'success',
        text: nextIdentity.loadedFromVault
          ? 'Vault loaded. Your Cardano address is ready.'
          : 'Vault created, encrypted, and stored on-chain. Your Cardano address is ready.'
      })
      playSfx('connect', sfxEnabled)
      await syncAddress(nextIdentity.address)
    } catch (error) {
      setStatus({
        kind: 'error',
        text: userFacingError(error, 'Could not open the Cardano vault.')
      })
      playSfx('error', sfxEnabled)
    } finally {
      setIsConnecting(false)
    }
  }

  const copyAddress = async () => {
    if (identity == null) return
    try {
      await navigator.clipboard.writeText(identity.address)
      setStatus({ kind: 'success', text: 'Address copied.' })
      playSfx('copy', sfxEnabled)
    } catch {
      setStatus({ kind: 'error', text: 'Clipboard access was blocked by the browser.' })
      playSfx('error', sfxEnabled)
    }
  }

  const toggleSfx = () => {
    setSfxEnabled(current => {
      const next = !current
      window.localStorage.setItem('cardano-wallet:sfx', next ? 'on' : 'off')
      playSfx('toggle', true)
      return next
    })
  }

  const reviewSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (identity == null) {
      await connect()
      return
    }
    setIsReviewing(true)
    setSendPreview(null)
    try {
      const amount = parseAdaToLovelace(sendForm.amount)
      const preview = await buildCardanoSendPreview({
        privateKey: identity.privateKey,
        recipient: sendForm.to,
        amount
      })
      setSendPreview(preview)
      setStatus({ kind: 'info', text: 'Review the Cardano transaction, then broadcast when ready.' })
      playSfx('review', sfxEnabled)
    } catch (error) {
      setStatus({
        kind: 'error',
        text: userFacingError(error, 'Could not prepare the send.')
      })
      playSfx('error', sfxEnabled)
    } finally {
      setIsReviewing(false)
    }
  }

  const broadcastSend = async () => {
    if (identity == null || sendPreview == null) return
    setIsSending(true)
    setStatus({ kind: 'info', text: 'Signing with the sealed Cardano key and submitting through Koios...' })
    try {
      const txid = await signAndSubmitCardano({
        privateKey: identity.privateKey,
        recipient: sendPreview.recipient,
        amount: sendPreview.amount
      })
      setLastBroadcastTxid(txid)
      setSendPreview(null)
      setSendForm(initialSendForm)
      setStatus({ kind: 'success', text: `Broadcast accepted: ${truncateMiddle(txid, 10, 10)}` })
      playSfx('send', sfxEnabled)
      await syncAddress(identity.address)
    } catch (error) {
      setStatus({
        kind: 'error',
        text: userFacingError(error, 'Broadcast failed.')
      })
      playSfx('error', sfxEnabled)
    } finally {
      setIsSending(false)
    }
  }

  useEffect(() => {
    if (identity == null) return
    return subscribeToAddress(identity.address, {
      onStatus: setLiveStatus,
      onTransaction: async () => {
        setStatus({ kind: 'success', text: 'Fresh Cardano activity detected. Syncing now.' })
        playSfx('receive', sfxEnabled)
        await syncAddress(identity.address)
      }
    })
  }, [identity, syncAddress, sfxEnabled])

  const transactions = addressState?.txrefs ?? []

  return (
    <main className="app-shell">
      <section className="hero-band" aria-label="Cardano Wallet overview">
        <img className="hero-image" src="/assets/cardano-wallet-hero.png" alt="" aria-hidden="true" />
        <div className="hero-shade" aria-hidden="true" />
        <div className="hero-content">
          <div className="brand-row">
            <span className="brand-mark" aria-hidden="true">C</span>
            <span>Cardano Wallet</span>
          </div>
          <h1>Cardano Wallet</h1>
          <p className="hero-copy">
            One ADA address, sealed by your BSV Metanet wallet. Peer-reviewed vibes, practical custody.
          </p>
          <p className="why-copy">For epochs, vaults, and improbable bridges.</p>
          <div className="hero-actions">
            <button className="primary-action" onClick={connect} disabled={isConnecting}>
              {isConnecting ? <Loader2 className="spin" aria-hidden /> : <Wallet aria-hidden />}
              Open Cardano Vault
            </button>
            <button
              className="icon-action"
              onClick={toggleSfx}
              aria-label={sfxEnabled ? 'Turn sound off' : 'Turn sound on'}
            >
              {sfxEnabled ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
            </button>
          </div>
        </div>
      </section>

      <section className="wallet-grid" aria-label="Wallet dashboard">
        <div className="balance-panel">
          <div className="panel-topline">
            <span>Balance</span>
            <span className={`live-pill live-${liveStatus}`}>
              <Radio aria-hidden />
              {getLiveLabel(liveStatus)}
            </span>
          </div>
          <div className="balance-main">{formatAdaWithUnit(balance)}</div>
          <div className="balance-subgrid">
            <div>
              <span>Spendable</span>
              <strong>{formatAdaWithUnit(balance)}</strong>
            </div>
            <div>
              <span>Pending</span>
              <strong>{formatAdaWithUnit(addressState?.pendingBalance ?? 0n)}</strong>
            </div>
            <div>
              <span>UTXOs</span>
              <strong>{addressState?.utxoCount ?? 0}</strong>
            </div>
          </div>
          <div className={`status-strip status-${status.kind}`}>{status.text}</div>
        </div>

        <div className="address-panel">
          <div className="panel-topline">
            <span>Receive Address</span>
            <button className="text-icon-button" onClick={() => setShowAddress(value => !value)}>
              {showAddress ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {showAddress ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="address-box">
            <code>
              {identity == null
                ? 'Open vault to derive ADA address'
                : showAddress ? identity.address : 'addr1******************************'}
            </code>
            <button
              className="icon-action compact"
              onClick={copyAddress}
              disabled={identity == null}
              aria-label="Copy address"
            >
              <Copy aria-hidden />
            </button>
          </div>
          {identity != null && (
            <a className="mini-link" href={cardanoExplorerAddressUrl(identity.address)} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden />
              View address
            </a>
          )}
        </div>
      </section>

      <section className="action-layout">
        <div className="mode-panel">
          <div className="segmented-control" role="tablist" aria-label="Wallet mode">
            <button
              className={mode === 'send' ? 'selected' : ''}
              role="tab"
              aria-selected={mode === 'send'}
              onClick={() => {
                setMode('send')
                playSfx('toggle', sfxEnabled)
              }}
            >
              <Send aria-hidden />
              Send
            </button>
            <button
              className={mode === 'receive' ? 'selected' : ''}
              role="tab"
              aria-selected={mode === 'receive'}
              onClick={() => {
                setMode('receive')
                playSfx('toggle', sfxEnabled)
              }}
            >
              <ArrowDownLeft aria-hidden />
              Receive
            </button>
          </div>

          {mode === 'send' ? (
            <form className="send-form" onSubmit={reviewSend}>
              <label>
                <span>Send to</span>
                <input
                  value={sendForm.to}
                  onChange={event => {
                    setSendPreview(null)
                    setSendForm(current => ({ ...current, to: event.target.value }))
                  }}
                  placeholder="addr1..."
                  autoComplete="off"
                />
              </label>
              <label>
                <span>Amount</span>
                <div className="amount-input">
                  <input
                    value={sendForm.amount}
                    onChange={event => {
                      setSendPreview(null)
                      setSendForm(current => ({ ...current, amount: event.target.value }))
                    }}
                    placeholder="0.00"
                    inputMode="decimal"
                  />
                  <strong>ADA</strong>
                </div>
              </label>
              <div className="fee-note">
                <ShieldCheck aria-hidden />
                Cardano fees and change are selected by Lucid against Koios UTXOs.
              </div>
              <button className="primary-action full" disabled={isReviewing || isSending}>
                {isReviewing ? <Loader2 className="spin" aria-hidden /> : <KeyRound aria-hidden />}
                Review Send
              </button>
            </form>
          ) : (
            <div className="receive-panel">
              <div className="qr-shell" aria-label="Cardano receive QR code">
                {identity == null ? (
                  <div className="qr-placeholder">Open vault</div>
                ) : (
                  <QRCodeSVG value={identity.address} size={320} bgColor="#ffffff" fgColor="#061526" />
                )}
              </div>
              <p>
                Share this address to receive ADA. Koios polling keeps the panel current as epochs roll forward.
              </p>
              <button className="secondary-action" onClick={copyAddress} disabled={identity == null}>
                <Copy aria-hidden />
                Copy Address
              </button>
            </div>
          )}

          {sendPreview != null && (
            <div className="send-preview">
              <div className="preview-row">
                <span>Amount</span>
                <strong>{formatAdaWithUnit(sendPreview.amount)}</strong>
              </div>
              <div className="preview-row">
                <span>Estimated fee</span>
                <strong>{sendPreview.fee == null ? 'Lucid selected' : formatAdaWithUnit(sendPreview.fee)}</strong>
              </div>
              <div className="preview-row">
                <span>Available</span>
                <strong>{formatAdaWithUnit(sendPreview.available)}</strong>
              </div>
              <div className="preview-row">
                <span>Draft hash</span>
                <strong>{truncateMiddle(sendPreview.txHash, 8, 8)}</strong>
              </div>
              <button className="primary-action full" onClick={broadcastSend} disabled={isSending}>
                {isSending ? <Loader2 className="spin" aria-hidden /> : <ArrowUpRight aria-hidden />}
                Sign and Broadcast
              </button>
            </div>
          )}
        </div>

        <div className="tx-panel">
          <div className="panel-topline">
            <span>Transactions</span>
            <button
              className="text-icon-button"
              onClick={() => identity != null && syncAddress(identity.address, true)}
              disabled={identity == null || isRefreshing}
            >
              {isRefreshing ? <Loader2 className="spin" aria-hidden /> : <RefreshCw aria-hidden />}
              Sync
            </button>
          </div>

          {lastBroadcastTxid != null && (
            <a className="broadcast-link" href={cardanoExplorerTxUrl(lastBroadcastTxid)} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden />
              Last broadcast {truncateMiddle(lastBroadcastTxid, 10, 10)}
              <ExternalLink aria-hidden />
            </a>
          )}

          <div className="tx-list">
            {transactions.length === 0 ? (
              <div className="empty-state">
                <BookOpen aria-hidden />
                <strong>No Cardano transactions yet.</strong>
                <span>Receive ADA or connect a funded address to populate the list.</span>
              </div>
            ) : (
              transactions.slice(0, 18).map(tx => (
                <a className="tx-row" href={cardanoExplorerTxUrl(tx.txHash)} target="_blank" rel="noreferrer" key={tx.txHash}>
                  <span className="tx-icon received">
                    <BookOpen aria-hidden />
                  </span>
                  <span>
                    <strong>Epoch activity</strong>
                    <small>{epochTimestamp(tx.blockTime)}</small>
                  </span>
                  <span className="tx-amount">{truncateMiddle(tx.txHash, 7, 6)}</span>
                </a>
              ))
            )}
          </div>
        </div>
      </section>
    </main>
  )
}
