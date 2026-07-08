# Cardano BRC100 Vault Protocol

## Namespace

- Protocol ID: `[1, "cardano"]`
- Key ID: `"1"`
- Counterparty: `"self"`
- Basket: `cardano:vault:v1`
- PushDrop magic: `cardano-wallet-vault-v1`

The first protocol element is the BRC100 security level. Cardano Wallet uses level `1` so another app cannot request the same encryption key through the wide-open level `0` namespace.

## BRC-116 Permission Manifest

The web app manifest declares the wallet scopes used by this protocol under `metanet.groupPermissions` and mirrors them under `babbage.groupPermissions` for legacy wallet compatibility:

- protocol permission for `[1, "cardano"]`
- basket access for `cardano:vault:v1`
- bounded monthly BSV spending authorization for the small PushDrop vault output

The protocol permission intentionally omits `counterparty` because BRC-116 scopes Level 1 protocol permissions by `protocolID`; runtime calls still use `counterparty: "self"` for BRC100 encryption and PushDrop locking.

## Vault Creation

1. Generate a Cardano/Lucid private key in the browser.
2. Encrypt the private key bytes through BRC100 `encrypt` with protocol ID `[1, "cardano"]`, key ID `"1"`, and counterparty `"self"`.
3. Build a PushDrop output with fields:
   - `cardano-wallet-vault-v1`
   - encrypted Cardano private key ciphertext
   - `encrypted cardano private key`
4. Store that PushDrop output in the `cardano:vault:v1` basket with a small BSV output.

## Vault Loading

1. Request wallet basket outputs with locking scripts from `cardano:vault:v1`.
2. Decode each locking script with `PushDrop.decode`.
3. Find the record whose first field is `cardano-wallet-vault-v1`.
4. Decrypt the ciphertext field through BRC100 `decrypt` with the same protocol/key tuple.
5. Use the recovered Cardano private key with Lucid.

## Address Derivation

1. Select the Cardano private key in Lucid.
2. Request the wallet payment address from Lucid.
3. Use the resulting Cardano mainnet address as the wallet's single receive address.

## Spending

1. Fetch spendable UTXOs for the derived address through Koios/Lucid.
2. Build a Cardano transaction with Lucid.
3. Sign the transaction with the decrypted Cardano private key.
4. Submit the signed transaction through the Koios provider.

The app never stores plaintext Cardano private key material on-chain. Anyone can see the PushDrop vault output, but only the matching BRC100 wallet and protocol/key tuple can decrypt its ciphertext.
