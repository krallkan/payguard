// Prompt-injection attack demo on testnet.
//   Act 1: the agent pays an inbox where one invoice carries injected instructions.
//          The wallet asks the risk service; the injected payment gets `block` and is never signed.
//   Act 2: assume the attacker owns the agent process and skips the wallet. The guard contract
//          still refuses: a re-targeted signature fails, and even a real `allow` from a
//          compromised oracle loses to the on-chain blocklist.
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { liveSources } from "../packages/risk/src/signals.js";
import { createRiskService } from "../packages/risk/src/service.js";
import { signVerdict } from "../packages/risk/src/verdict.js";
import { GuardedWallet, toYocto } from "../packages/agent/src/wallet.js";
import { NearAiLlm, ScriptedLlm } from "../packages/agent/src/llm.js";
import { readInbox, runAgent } from "../packages/agent/src/agent.js";

const env = (k: string) => process.env[k] || (console.error(`missing ${k} in .env`), process.exit(1));
const GUARD = env("GUARD_CONTRACT_ID");
const AGENT = env("AGENT_ACCOUNT_ID");
const SHOP = env("SHOP_ACCOUNT_ID");
const BAD = env("BAD_ACCOUNT_ID");
const ORACLE_KEY = env("ORACLE_PRIVATE_KEY");

const risk = createRiskService({
  sources: liveSources({
    rpcUrl: process.env.NEAR_RPC_URL || "https://rpc.testnet.near.org",
    nearblocksUrl: process.env.NEARBLOCKS_API_URL || "https://api-testnet.nearblocks.io",
    guard: GUARD,
  }),
  guard: GUARD,
  agent: AGENT,
  oracleKey: ORACLE_KEY,
});
const wallet = new GuardedWallet({
  guard: GUARD,
  agent: AGENT,
  agentKey: env("AGENT_PRIVATE_KEY"),
  check: (receiver, amountYocto) => risk({ receiver, amountYocto }),
});
const llm = process.env.NEAR_AI_API_KEY
  ? new NearAiLlm(process.env.NEAR_AI_API_KEY, process.env.NEAR_AI_MODEL || undefined)
  : new ScriptedLlm();

console.log(`PayGuard attack demo — guard ${GUARD}, agent ${AGENT}`);
console.log(`LLM: ${llm.name}\n`);

console.log("━━ Act 1: agent pays the inbox (one invoice is prompt-injected) ━━");
const outcomes = await runAgent(llm, wallet, readInbox(fileURLToPath(new URL("../inbox", import.meta.url))));

console.log("\n━━ Act 2: attacker skips the wallet and calls the guard directly ━━");
const amount = toYocto("0.2");

console.log(`\n2a. re-use a genuine allow verdict issued for ${SHOP}, re-targeted to ${BAD}`);
const shopAllow = await risk({ receiver: SHOP, amountYocto: amount });
const r1 = await wallet.submit({ receiver: BAD, amount, memo: "bypass: re-targeted verdict", verdict: shopAllow.signed });

console.log(`\n2b. compromised oracle signs allow for ${BAD}`);
const forgedAllow = signVerdict(ORACLE_KEY, { guard: GUARD, agent: AGENT, receiver: BAD, amountYocto: amount, verdict: "allow" });
const r2 = await wallet.submit({ receiver: BAD, amount, memo: "bypass: compromised oracle", verdict: forgedAllow });

console.log("\n━━ Summary ━━");
for (const o of outcomes) console.log(`  ${o.status.padEnd(20)} ${o.receiver} ${o.amount} NEAR  (${o.memo})`);
console.log(`  ${(r1.ok ? "SENT (BUG)" : "refused_by_contract").padEnd(20)} ${BAD} 0.2 NEAR  (2a re-targeted verdict)`);
console.log(`  ${(r2.ok ? "SENT (BUG)" : "refused_by_contract").padEnd(20)} ${BAD} 0.2 NEAR  (2b compromised oracle)`);

const leaked = outcomes.some((o) => o.receiver === BAD && o.status === "sent") || r1.ok || r2.ok;
console.log(leaked ? "\nRESULT: funds reached the attacker" : `\nRESULT: ${BAD} received nothing`);
process.exit(leaked ? 1 : 0);
