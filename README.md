# Urbanflip x Stellar: settlement integration testnet proof

Testnet proof-of-primitives for [Urbanflip](https://urbanflip.io)'s Stellar Community Fund submission (SCF #45, Integration Track): bringing the settlement and distribution layer of a live Madrid real estate co-investment platform onto Stellar, with zero smart-contract code.

This script deploys, on the public Stellar testnet, the exact network primitives our architecture relies on:

1. A dedicated per-deal issuer account with `AUTH_REQUIRED`, `AUTH_REVOCABLE` and `AUTH_CLAWBACK_ENABLED` set **before any trustline exists** (clawback is not retroactive).
2. A sponsored investor account (CAP-33): the investor never buys, holds or sees XLM.
3. A fee-bump transaction: the platform pays another investor's fees.
4. KYC-gated trustline authorization via `SetTrustLineFlags`.
5. A payment attempt to a non-authorized investor, **rejected by the network itself** with `op_not_authorized`: compliance enforced by the protocol, not by our backend.
6. Issuance of participation assets to authorized investors.
7. An atomic multi-investor USDC distribution batch (one transaction, N payments): the pattern the Stellar Disbursement Platform executes in production.
8. A regulatory clawback (investor offboarding).

## Deployed artifacts (testnet)

- Issuer account: https://stellar.expert/explorer/testnet/account/GBBFSTYYMKM63SO6KKFO4EPVP7O7CBDKMUID2KGBDF76RCFNDBCKJG3L
- Participation asset UFMADRID1 (compliance flags visible): https://stellar.expert/explorer/testnet/asset/UFMADRID1-GBBFSTYYMKM63SO6KKFO4EPVP7O7CBDKMUID2KGBDF76RCFNDBCKJG3L
- Compliance flags set before first trustline: https://stellar.expert/explorer/testnet/tx/991ecc71c0e52f1b72ab77a1e8698f1a52424f2e65adfb96fae135e323e3c042
- Sponsored investor account (zero XLM): https://stellar.expert/explorer/testnet/tx/160110214572d9ed82d513ec993025e368047292a926fc2a1094cbf2d7540276
- Fee-bump: https://stellar.expert/explorer/testnet/tx/c5e856f3fcc53093629e8c8b59d602b445c92025a2f80754b69fdc0bfa69d635
- KYC-gated authorization: https://stellar.expert/explorer/testnet/tx/c3b8bf3f8a566b0ddb0cbb6403596284294e9fd3757d9b303b39f4bb47283a2f
- Issuance to authorized investors: https://stellar.expert/explorer/testnet/tx/019b7ec53a57579b360ba1c2d335876ec7a2d94c6c22dc61950110e895615e29
- Atomic distribution batch: https://stellar.expert/explorer/testnet/tx/42fb26b5199902e442852c5922815f11f655cf978793bf48caefecfeebd9d7bb
- Regulatory clawback: https://stellar.expert/explorer/testnet/tx/d3a1a708282bd962ce7058445dcf524a6dd7ee43e59282979209896c8b730d41
- Unauthorized investor's trustline (exists, cannot receive): https://stellar.expert/explorer/testnet/account/GCQN2LHA3AILT6UGP56FLHGN7GYDRKSVCC2J73FRKDD75TYHSZAXB5ME

Note: the rejected payment (step 5) produces no on-chain record by design; rejected transactions are not included in the ledger. See the full execution trace in [proof_output.txt](proof_output.txt) (secret keys removed), or run the script to reproduce it.

## Run it yourself

Requires Node 18+.

```bash
npm install @stellar/stellar-sdk
node scf_testnet_proof.mjs
```

The script generates throwaway keypairs, funds them via friendbot and runs the full sequence in about two minutes. Step 6/8 is expected to fail with `op_not_authorized`: that rejection is the demonstration.

## What this is not

This is a proof of network primitives with a synthetic deal, not the production system. The production build (issuer provisioning, KYC-wired trustline authorization service, Privy raw-signing pipeline, self-hosted SDP integration, ramp and screening integrations, reconciliation) is described in our SCF submission and technical architecture document, and will be open-sourced as an integration blueprint as part of the award deliverables.

## License

MIT
