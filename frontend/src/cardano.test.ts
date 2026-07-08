import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  CARDANO_BASKET,
  CARDANO_KEY_ID,
  CARDANO_PROTOCOL_ID,
  createTestLucid,
  formatLovelace,
  identityFromPrivateKey,
  parseAdaToLovelace,
  validateCardanoAddress
} from './cardano'
import { generatePrivateKey } from '@lucid-evolution/lucid'

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../public/manifest.json', import.meta.url)), 'utf8')
) as any

describe('cardano helpers', () => {
  it('uses a restricted BRC100 security level for Cardano vault keys', () => {
    expect(CARDANO_PROTOCOL_ID).toEqual([1, 'cardano'])
    expect(CARDANO_KEY_ID).toBe('1')
  })

  it('formats and parses ADA amounts without floating point math', () => {
    expect(parseAdaToLovelace('1')).toBe(1000000n)
    expect(parseAdaToLovelace('1.250001')).toBe(1250001n)
    expect(formatLovelace(1234567n)).toBe('1.234567')
    expect(formatLovelace(1200000n)).toBe('1.2')
  })

  it('rejects dust-sized sends and too many decimals', () => {
    expect(() => parseAdaToLovelace('0.999999')).toThrow(/at least 1 ADA/i)
    expect(() => parseAdaToLovelace('1.0000001')).toThrow(/up to 6 decimal/i)
  })

  it('derives a Cardano mainnet address from a Lucid private key', async () => {
    const identity = await identityFromPrivateKey(generatePrivateKey(), createTestLucid)
    expect(identity.address.startsWith('addr1')).toBe(true)
    expect(identity.publicKey.length).toBeGreaterThan(20)
    expect(identity.loadedFromVault).toBe(true)
    expect(() => validateCardanoAddress(identity.address)).not.toThrow()
  })

  it('rejects non-mainnet addresses', () => {
    expect(() => validateCardanoAddress('addr_test1vrwgpqx9n8ny456pp3k8h7xwtw504gwupq342g8f5qkplgsmst5v9'))
      .toThrow(/mainnet/i)
  })

  it('declares BRC-116 grouped permissions for every wallet scope it uses', () => {
    const metanet = manifest.metanet.groupPermissions
    expect(manifest.metanet.schemaVersion).toBe(1)
    expect(metanet.protocolPermissions).toContainEqual({
      protocolID: CARDANO_PROTOCOL_ID,
      description: expect.any(String)
    })
    expect(metanet.basketAccess).toContainEqual({
      basket: CARDANO_BASKET,
      description: expect.any(String)
    })
    expect(metanet.spendingAuthorization.amount).toBeGreaterThanOrEqual(10000)
    expect(manifest.babbage.groupPermissions).toEqual(metanet)
  })
})
