// Phase 2 smoke test on testnet: one real payment through the guard, then two attempts that the
// contract must refuse. The agent signs with its function-call key only.
import "dotenv/config";
import { Near } from "near-kit";
import { signVerdict, verdictMessage, type Verdict } from "../packages/risk/src/verdict.js";

const need = (k: string) => process.env[k] || (console.error(`missing ${k} in .env`), process.exit(1));
const GUARD = need("GUARD_CONTRACT_ID");
const AGENT = need("AGENT_ACCOUNT_ID");
const SHOP = need("SHOP_ACCOUNT_ID");
const BAD = need("BAD_ACCOUNT_ID");
const ORACLE_KEY = need("ORACLE_PRIVATE_KEY");
const explorer = (h: string | null) => `https://testnet.nearblocks.io/txns/${h}`;

const near = new Near({ network: "testnet", privateKey: need("AGENT_PRIVATE_KEY") as `ed25519:${string}`, defaultSignerId: AGENT });

// The contract and this code must build the exact same message.
const probe = { nonce: "1", expires_at: "2" };
const onChain = await near.view<string>(GUARD, "verdict_message", {
  agent: AGENT, receiver: SHOP, amount: "1", verdict: "allow", ...probe,
});
const local = verdictMessage(GUARD, AGENT, SHOP, "1", "allow", probe.nonce, probe.expires_at);
console.log(`message format matches contract: ${onChain === local}`);
if (onChain !== local) process.exit(1);

async function attempt(label: string, receiver: string, amountYocto: string, verdict: Verdict) {
  const signed = signVerdict(ORACLE_KEY, { guard: GUARD, agent: AGENT, receiver, amountYocto, verdict });
  const tx = near.transaction(AGENT).functionCall(
    GUARD,
    "pay",
    { receiver, amount: amountYocto, memo: label, verdict: signed },
    { gas: "50 Tgas" },
  );
  await tx.sign();
  const hash = tx.getHash();
  try {
    await tx.send();
    console.log(`\n[OK]      ${label}\n          ${explorer(hash)}`);
  } catch (e: any) {
    console.log(`\n[REFUSED] ${label}\n          reason: ${e.panic ?? e.message}\n          ${explorer(hash)}`);
  }
}

const tenth = "100000000000000000000000"; // 0.1 NEAR
await attempt(`pay ${SHOP} 0.1 NEAR with an allow verdict`, SHOP, tenth, "allow");
await attempt(`pay ${BAD} 0.1 NEAR with a block verdict`, BAD, tenth, "block");
await attempt(`pay ${BAD} 0.1 NEAR with an allow verdict (compromised oracle)`, BAD, tenth, "allow");

const payments = await near.view<any[]>(GUARD, "get_payments", {});
const cfg = await near.view<any>(GUARD, "get_config", {});
console.log(`\non-chain payment log: ${JSON.stringify(payments?.map((p) => [p.id, p.receiver, p.status]))}`);
console.log(`spent today: ${cfg.spent_today} yocto, available: ${cfg.available} yocto`);
