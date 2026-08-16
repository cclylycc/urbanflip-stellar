#!/usr/bin/env node
/**
 * Urbanflip x Stellar: SCF #45 testnet proof
 * ------------------------------------------
 * Demuestra en testnet el nucleo exacto de la submission:
 *   1. Emisor por operacion con flags de compliance (AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED)
 *      fijados ANTES del primer trustline (clawback no es retroactivo).
 *   2. Cuenta de inversor patrocinada (CAP-33 sponsorship sandwich): el inversor no toca XLM.
 *   3. Trustline autorizado solo tras "KYC" (SetTrustLineFlags authorized=true).
 *   4. Pago a inversor NO autorizado -> falla (la compliance se aplica a nivel de protocolo).
 *   5. Emision de participaciones UFMADRID1 a inversores autorizados.
 *   6. Batch de distribucion en USDC de prueba: 1 transaccion, N operaciones de pago (lo que SDP hace en produccion).
 *   7. Fee-bump: la plataforma paga los fees de una tx del inversor.
 *   8. Clawback ejecutado sobre un inversor (offboarding regulatorio).
 *
 * Uso:
 *   mkdir uf-testnet && cd uf-testnet
 *   npm init -y && npm i @stellar/stellar-sdk
 *   node scf_testnet_proof.mjs
 *
 * Requiere Node 18+ (fetch global). Salida: enlaces stellar.expert listos para pegar en la submission.
 * Todo es testnet: claves desechables, sin ningun dato real.
 */

import {
  Keypair, Horizon, TransactionBuilder, Networks, Operation, Asset, BASE_FEE,
  AuthRequiredFlag, AuthRevocableFlag, AuthClawbackEnabledFlag,
} from "@stellar/stellar-sdk";

const HORIZON = "https://horizon-testnet.stellar.org";
const server = new Horizon.Server(HORIZON);
const NET = Networks.TESTNET;
const EXPERT = "https://stellar.expert/explorer/testnet";

const links = [];
const log = (m) => console.log(m);
const link = (label, url) => { links.push([label, url]); log(`  -> ${label}: ${url}`); };
const txLink = (label, res) => link(label, `${EXPERT}/tx/${res.hash}`);

async function friendbot(pk) {
  const r = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(pk)}`);
  if (!r.ok && r.status !== 400) throw new Error(`friendbot ${pk}: ${r.status}`);
}

async function submit(tx, label) {
  try {
    const res = await server.submitTransaction(tx);
    txLink(label, res);
    return res;
  } catch (e) {
    const codes = e?.response?.data?.extras?.result_codes;
    throw Object.assign(new Error(`${label}: ${JSON.stringify(codes || e.message)}`), { codes });
  }
}

async function buildTx(sourcePk, ops, signers, { feeMult = 1 } = {}) {
  const account = await server.loadAccount(sourcePk);
  const b = new TransactionBuilder(account, { fee: String(BASE_FEE * feeMult * Math.max(ops.length, 1)), networkPassphrase: NET });
  ops.forEach((op) => b.addOperation(op));
  const tx = b.setTimeout(120).build();
  signers.forEach((kp) => tx.sign(kp));
  return tx;
}

const main = async () => {
  log("\n=== Urbanflip x Stellar: testnet proof ===\n");

  // Cuentas: PLATFORM (Urbanflip ops), ISSUER (emisor de la operacion MADRID-1),
  // TREASURY (emisor del USDC de prueba), 3 inversores.
  const platform = Keypair.random();
  const issuer = Keypair.random();
  const treasury = Keypair.random();
  const invA = Keypair.random(); // KYC ok, cuenta patrocinada
  const invB = Keypair.random(); // KYC ok
  const invC = Keypair.random(); // SIN KYC -> debe ser rechazado

  log("[1/8] Fondeando cuentas base via friendbot (platform, issuer, treasury, invB, invC)...");
  await Promise.all([platform, issuer, treasury, invB, invC].map((k) => friendbot(k.publicKey())));
  link("Platform account", `${EXPERT}/account/${platform.publicKey()}`);
  link("Issuer (operacion MADRID-1)", `${EXPERT}/account/${issuer.publicKey()}`);

  // Assets
  const UF = new Asset("UFMADRID1", issuer.publicKey());   // participacion de la operacion
  const USDC = new Asset("USDC", treasury.publicKey());     // USDC de prueba (en produccion: USDC de Circle)

  log("\n[2/8] Fijando flags de compliance en el emisor ANTES de cualquier trustline...");
  await submit(await buildTx(issuer.publicKey(), [
    Operation.setOptions({
      setFlags: AuthRequiredFlag | AuthRevocableFlag | AuthClawbackEnabledFlag,
      homeDomain: "urbanflip.io",
    }),
  ], [issuer]), "SetOptions: AUTH_REQUIRED + AUTH_REVOCABLE + AUTH_CLAWBACK_ENABLED + home_domain");

  log("\n[3/8] Creando cuenta del inversor A PATROCINADA (CAP-33): el inversor nunca compra XLM...");
  // Sandwich: platform patrocina reservas de la cuenta nueva y de su trustline.
  await submit(await buildTx(platform.publicKey(), [
    Operation.beginSponsoringFutureReserves({ sponsoredId: invA.publicKey() }),
    Operation.createAccount({ destination: invA.publicKey(), startingBalance: "0" }),
    Operation.changeTrust({ asset: UF, source: invA.publicKey() }),
    Operation.changeTrust({ asset: USDC, source: invA.publicKey() }),
    Operation.endSponsoringFutureReserves({ source: invA.publicKey() }),
  ], [platform, invA]), "Cuenta invA creada con reservas y trustlines patrocinados");

  log("\n[4/8] Trustlines de invB (fee pagado por la plataforma via FEE-BUMP) y de invC...");
  const invBTrust = await buildTx(invB.publicKey(), [
    Operation.changeTrust({ asset: UF }),
    Operation.changeTrust({ asset: USDC }),
  ], [invB]);
  const feeBumped = TransactionBuilder.buildFeeBumpTransaction(platform, String(BASE_FEE * 10), invBTrust, NET);
  feeBumped.sign(platform);
  await submit(feeBumped, "Fee-bump: platform paga los fees del trustline de invB");
  await submit(await buildTx(invC.publicKey(), [Operation.changeTrust({ asset: UF })], [invC]),
    "Trustline de invC (existira, pero NO sera autorizado)");

  log("\n[5/8] Autorizando SOLO a los inversores con KYC aprobado (invA, invB)...");
  await submit(await buildTx(issuer.publicKey(), [
    Operation.setTrustLineFlags({ trustor: invA.publicKey(), asset: UF, flags: { authorized: true } }),
    Operation.setTrustLineFlags({ trustor: invB.publicKey(), asset: UF, flags: { authorized: true } }),
  ], [issuer]), "Trustlines autorizados tras KYC (invA, invB)");

  log("\n[6/8] Intentando emitir participaciones a invC (SIN KYC): debe FALLAR a nivel de protocolo...");
  try {
    await submit(await buildTx(issuer.publicKey(), [
      Operation.payment({ destination: invC.publicKey(), asset: UF, amount: "1000" }),
    ], [issuer]), "NO DEBERIA VERSE: pago a inversor no autorizado");
    log("  !! INESPERADO: el pago a invC fue aceptado. Revisar flags.");
  } catch (e) {
    log(`  OK: rechazado por el protocolo (${JSON.stringify(e.codes?.operations || e.message)})`);
    log("  (Este rechazo es la prueba de que la compliance vive en el protocolo, no en nuestro backend.)");
  }

  log("\n[7/8] Emitiendo participaciones a los inversores autorizados (pro-rata de ejemplo)...");
  await submit(await buildTx(issuer.publicKey(), [
    Operation.payment({ destination: invA.publicKey(), asset: UF, amount: "150000" }), // 150.000 EUR de participacion
    Operation.payment({ destination: invB.publicKey(), asset: UF, amount: "100000" }),
  ], [issuer]), "Emision UFMADRID1 a invA (150k) e invB (100k)");
  link("Asset UFMADRID1", `${EXPERT}/asset/UFMADRID1-${issuer.publicKey()}`);

  log("\n[8/8] Batch de distribucion en USDC: 1 transaccion, N pagos (el patron que SDP ejecuta en produccion)...");
  // Fondeamos el asset de prueba y pagamos pro-rata en un solo batch atomico.
  await submit(await buildTx(treasury.publicKey(), [
    Operation.payment({ destination: invA.publicKey(), asset: USDC, amount: "9000" }),   // 60% pro-rata
    Operation.payment({ destination: invB.publicKey(), asset: USDC, amount: "6000" }),   // 40% pro-rata
  ], [treasury]), "Batch USDC: distribucion pro-rata a 2 inversores en una tx atomica");

  log("\n[extra] Clawback regulatorio: recuperando la posicion de invB (offboarding)...");
  await submit(await buildTx(issuer.publicKey(), [
    Operation.clawback({ from: invB.publicKey(), asset: UF, amount: "100000" }),
  ], [issuer]), "Clawback de UFMADRID1 desde invB");

  log("\n=== COMPLETADO ===\n");
  log("Enlaces para la submission (stellar.expert, testnet):\n");
  links.forEach(([l, u]) => log(`- ${l}\n  ${u}`));
  log("\nGuarda tambien las claves publicas por si el equipo quiere ampliar la demo:");
  log(`  PLATFORM: ${platform.publicKey()}\n  ISSUER:   ${issuer.publicKey()}\n  TREASURY: ${treasury.publicKey()}`);
  log(`  INV_A:    ${invA.publicKey()}\n  INV_B:    ${invB.publicKey()}\n  INV_C:    ${invC.publicKey()}`);
  log("\nSecretas (SOLO testnet, desechables):");
  [["PLATFORM", platform], ["ISSUER", issuer], ["TREASURY", treasury]].forEach(([n, k]) => log(`  ${n}: ${k.secret()}`));
};

main().catch((e) => { console.error("\nERROR:", e.message); process.exit(1); });
