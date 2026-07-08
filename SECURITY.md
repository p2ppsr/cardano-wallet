# Security Notes

Cardano Wallet is frontend-only and BRC100-vault-backed.

- The Cardano private key is generated in the browser, encrypted with BRC100 `encrypt`, and stored as PushDrop ciphertext.
- The plaintext Cardano private key is visible to the browser process after BRC100 `decrypt` so Lucid can sign Cardano transactions.
- No seed phrase is accepted by the UI.
- Koios tokens are optional and must be treated as public frontend configuration.
- Transaction preview should be checked before broadcasting.
- This code is not a substitute for an audited hardware-wallet or full-node wallet.

Known tradeoffs:

- Balance and transaction history come from Koios.
- Live updates use Koios polling because there is no tokenless public Cardano address WebSocket equivalent to BlockCypher's Dogecoin socket.
- Losing the BRC100 wallet or changing the exact protocol/key tuple means the PushDrop vault cannot be decrypted.
