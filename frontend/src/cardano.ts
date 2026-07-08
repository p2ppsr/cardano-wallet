import { PushDrop, Script, Utils, type WalletInterface, type WalletProtocol } from '@bsv/sdk'
import {
  Emulator,
  Koios,
  Lucid,
  generatePrivateKey,
  getAddressDetails,
  toPublicKey,
  type LucidEvolution
} from '@lucid-evolution/lucid'

export const CARDANO_PROTOCOL_ID: WalletProtocol = [1, 'cardano']
export const CARDANO_KEY_ID = '1'
export const CARDANO_BASKET = 'cardano:vault:v1'
export const CARDANO_VAULT_MAGIC = 'cardano-wallet-vault-v1'
export const CARDANO_NETWORK = 'Mainnet'
export const KOIOS_API_BASE = import.meta.env.VITE_KOIOS_API_BASE?.trim() || '/api/koios'
export const LOVELACE_PER_ADA = 1000000n
export const MIN_ADA_SEND = 1000000n

export interface CardanoIdentity {
  address: string
  publicKey: string
  privateKey: string
  loadedFromVault: boolean
}

export interface CardanoSendPreview {
  recipient: string
  amount: bigint
  available: bigint
  fee: bigint | null
  txHash: string
  cborBytes: number
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

const stringToBytes = (value: string): number[] => Array.from(textEncoder.encode(value))

const bytesToString = (bytes: number[] | Uint8Array): string => {
  return textDecoder.decode(Uint8Array.from(bytes))
}

export const bytesToHex = (bytes: number[] | Uint8Array): string => Utils.toHex(Array.from(bytes))

export const parseAdaToLovelace = (amount: string): bigint => {
  const normalized = amount.trim()
  if (!/^\d+(\.\d{0,6})?$/.test(normalized)) {
    throw new Error('Enter an ADA amount with up to 6 decimal places')
  }
  const [whole, fractional = ''] = normalized.split('.')
  const lovelace = BigInt(whole) * LOVELACE_PER_ADA + BigInt(fractional.padEnd(6, '0'))
  if (lovelace <= 0n) throw new Error('Amount must be greater than zero')
  if (lovelace < MIN_ADA_SEND) throw new Error('Send at least 1 ADA to satisfy Cardano minimum output rules')
  return lovelace
}

export const formatLovelace = (value: bigint, maxDecimals = 6): string => {
  const sign = value < 0n ? '-' : ''
  const abs = value < 0n ? -value : value
  const whole = abs / LOVELACE_PER_ADA
  const fractional = (abs % LOVELACE_PER_ADA).toString().padStart(6, '0')
  const trimmed = fractional.slice(0, maxDecimals).replace(/0+$/, '')
  return `${sign}${whole.toString()}${trimmed.length > 0 ? `.${trimmed}` : ''}`
}

export const formatAdaWithUnit = (value: bigint, maxDecimals = 6): string => {
  return `${formatLovelace(value, maxDecimals)} ADA`
}

export const truncateMiddle = (value: string, left = 10, right = 8): string => {
  if (value.length <= left + right + 3) return value
  return `${value.slice(0, left)}...${value.slice(-right)}`
}

export const validateCardanoAddress = (address: string): void => {
  const details = getAddressDetails(address.trim())
  if (details.address.bech32 !== address.trim()) throw new Error('Invalid Cardano address')
  if (details.networkId !== 1) throw new Error('Use a Cardano mainnet address')
  if (details.type !== 'Base' && details.type !== 'Enterprise') {
    throw new Error('Use a standard Cardano payment address')
  }
}

const createKoiosProvider = (): Koios => {
  const token = import.meta.env.VITE_KOIOS_TOKEN?.trim()
  return new Koios(KOIOS_API_BASE, token && token.length > 0 ? token : undefined)
}

export const createCardanoLucid = async (privateKey: string): Promise<LucidEvolution> => {
  const lucid = await Lucid(createKoiosProvider(), CARDANO_NETWORK)
  lucid.selectWallet.fromPrivateKey(privateKey)
  return lucid
}

export const createTestLucid = async (privateKey: string): Promise<LucidEvolution> => {
  const lucid = await Lucid(new Emulator([]), CARDANO_NETWORK)
  lucid.selectWallet.fromPrivateKey(privateKey)
  return lucid
}

export const identityFromPrivateKey = async (
  privateKey: string,
  lucidFactory: (privateKey: string) => Promise<LucidEvolution> = createTestLucid,
  loadedFromVault = true
): Promise<CardanoIdentity> => {
  const lucid = await lucidFactory(privateKey)
  const address = await lucid.wallet().address()
  return {
    address,
    privateKey,
    publicKey: toPublicKey(privateKey),
    loadedFromVault
  }
}

const decodeVaultPrivateKey = async (wallet: WalletInterface, lockingScript: string): Promise<string | null> => {
  const script = Script.fromHex(lockingScript) as any
  const decoded = PushDrop.decode(script)
  const fields = decoded.fields as number[][] | undefined
  if (!fields || fields.length < 2) return null
  const magic = bytesToString(fields[0])
  if (magic !== CARDANO_VAULT_MAGIC) return null

  const { plaintext } = await (wallet as any).decrypt({
    ciphertext: fields[1],
    protocolID: CARDANO_PROTOCOL_ID,
    keyID: CARDANO_KEY_ID,
    counterparty: 'self'
  })
  return bytesToString(plaintext)
}

const storeVaultPrivateKey = async (wallet: WalletInterface, privateKey: string): Promise<void> => {
  const { ciphertext } = await (wallet as any).encrypt({
    plaintext: stringToBytes(privateKey),
    protocolID: CARDANO_PROTOCOL_ID,
    keyID: CARDANO_KEY_ID,
    counterparty: 'self'
  })

  const pushDrop = new PushDrop(wallet as any)
  const locking = await pushDrop.lock(
    [
      stringToBytes(CARDANO_VAULT_MAGIC),
      ciphertext,
      stringToBytes('encrypted cardano private key')
    ],
    CARDANO_PROTOCOL_ID,
    CARDANO_KEY_ID,
    'self',
    true,
    false,
    'before'
  )

  await (wallet as any).createAction({
    description: 'store cardano key vault',
    outputs: [
      {
        lockingScript: locking.toHex(),
        satoshis: 600,
        outputDescription: 'cardano sealed vault',
        basket: CARDANO_BASKET,
        tags: ['cardano', 'vault', 'v1']
      }
    ]
  })
}

export const ensureCardanoIdentity = async (
  wallet: WalletInterface,
  lucidFactory: (privateKey: string) => Promise<LucidEvolution> = createCardanoLucid
): Promise<CardanoIdentity> => {
  const outputs = await (wallet as any).listOutputs({
    basket: CARDANO_BASKET,
    include: 'locking scripts',
    limit: 10
  })

  for (const output of outputs.outputs ?? []) {
    const lockingScript = output.lockingScript
    if (typeof lockingScript !== 'string' || lockingScript.length === 0) continue
    const privateKey = await decodeVaultPrivateKey(wallet, lockingScript)
    if (privateKey != null) return identityFromPrivateKey(privateKey, lucidFactory, true)
  }

  const privateKey = generatePrivateKey()
  await storeVaultPrivateKey(wallet, privateKey)
  return identityFromPrivateKey(privateKey, lucidFactory, false)
}

const sumLovelace = (utxos: Array<{ assets: Record<string, bigint> }>): bigint => {
  return utxos.reduce((sum, utxo) => sum + (utxo.assets.lovelace ?? 0n), 0n)
}

const extractFee = (json: unknown): bigint | null => {
  const body = typeof json === 'object' && json !== null && 'body' in json ? (json as any).body : undefined
  const fee = body && typeof body === 'object' ? body.fee : undefined
  if (typeof fee === 'bigint') return fee
  if (typeof fee === 'number' && Number.isFinite(fee)) return BigInt(Math.trunc(fee))
  if (typeof fee === 'string' && /^\d+$/.test(fee)) return BigInt(fee)
  return null
}

export const buildCardanoSendPreview = async (params: {
  privateKey: string
  recipient: string
  amount: bigint
}): Promise<CardanoSendPreview> => {
  validateCardanoAddress(params.recipient)
  const lucid = await createCardanoLucid(params.privateKey)
  const address = await lucid.wallet().address()
  const utxos = await lucid.utxosAt(address)
  const available = sumLovelace(utxos as Array<{ assets: Record<string, bigint> }>)
  if (available <= params.amount) {
    throw new Error(`Insufficient ADA. Available: ${formatAdaWithUnit(available)} before fees.`)
  }

  const tx = await lucid
    .newTx()
    .pay.ToAddress(params.recipient.trim(), { lovelace: params.amount })
    .complete()

  const cbor = tx.toCBOR()
  return {
    recipient: params.recipient.trim(),
    amount: params.amount,
    available,
    fee: extractFee(tx.toJSON()),
    txHash: tx.toHash(),
    cborBytes: Math.ceil(cbor.length / 2)
  }
}

export const signAndSubmitCardano = async (params: {
  privateKey: string
  recipient: string
  amount: bigint
}): Promise<string> => {
  validateCardanoAddress(params.recipient)
  const lucid = await createCardanoLucid(params.privateKey)
  const tx = await lucid
    .newTx()
    .pay.ToAddress(params.recipient.trim(), { lovelace: params.amount })
    .complete()
  const signed = await tx.sign.withWallet().complete()
  return signed.submit()
}
