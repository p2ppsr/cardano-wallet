# Cardano Wallet

Dead-simple Cardano custody through a BRC100-sealed vault.

For epochs, vaults, and improbable bridges.

## What It Does

- Creates or loads one Cardano mainnet payment address.
- Generates a Lucid/Cardano private key client-side because Cardano uses Ed25519-era wallet primitives instead of the BSV wallet's signing curve.
- Encrypts that Cardano key with BRC100 `encrypt` using protocol ID `[1, "cardano"]` and key ID `"1"`.
- Stores the ciphertext in a PushDrop output in the `cardano:vault:v1` basket.
- Uses BRC100 `decrypt` to load the sealed vault on future visits.
- Reads balance, UTXOs, chain tip, and recent transactions from Koios.
- Builds, signs, and submits ADA transactions through Lucid Evolution and the Koios provider.
- Runs as a frontend-only LARS/CARS/BRC102 project.

The app never asks for a seed phrase. The browser process does see the raw Cardano private key after decrypting the vault so it can sign Cardano transactions with Lucid. Keep that security model in mind.

## Status

This is experimental wallet software, not audited financial infrastructure. Start with a small amount of ADA and inspect the transaction preview before broadcasting.

## Local Development

```bash
npm install
npm --prefix frontend install
npm run frontend:dev
```

Or run through LARS:

```bash
npm run lars
npm run start
```

The frontend defaults to `http://localhost:8080` when run through Vite.

## Optional Koios Token

Koios works publicly, but production deployments can set a public frontend token for higher limits:

```bash
VITE_KOIOS_TOKEN=your-public-koios-token
```

Do not put private service credentials in this frontend.

## Validation

```bash
npm --prefix frontend test -- --run
npm --prefix frontend run build
npm --prefix frontend run qa:responsive
```

The responsive QA script starts the built app locally and checks desktop/tablet/mobile viewports for horizontal overflow, console errors, and the expected wallet UI.

## Deployment

This repo follows the standard BSV app layout:

- `deployment-info.json`
- `frontend/`
- CARS config named `Babbage`

The production workflow deploys pushes to `master` through CARS. Required GitHub Actions secret:

- `CARS_PRIVATE_KEY`

Optional secret:

- `CARS_WALLET_STORAGE`

Production domain target:

- `https://cardano.metanet.app`

## Protocol

See [PROTOCOL.md](./PROTOCOL.md).

## License

[Open BSV License](./LICENSE.txt)
