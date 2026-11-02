// Prompt-injection attack demo. Runs in demo mode by default (no keys, no funds); DEMO=0 runs it
// against the deployed testnet contract.
//   Act 1: the agent pays an inbox where one invoice carries injected instructions.
//          The wallet asks the risk service; the injected payment gets `block` and is never signed.
//   Act 2: assume the attacker owns the agent process and skips the wallet. The guard contract
//          still refuses: a re-targeted signature fails, and even a real `allow` from a
//          compromised oracle loses to the on-chain blocklist.
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { createContext } from "../packages/app/src/context.js";
import { toYocto } from "../packages/agent/src/wallet.js";
import { readInbox, runAgent } from "../packages/agent/src/agent.js";

const ctx = await createContext();
const { guard: GUARD, agent: AGENT, shop: SHOP, bad: BAD } = ctx.ids;
const wallet = ctx.wallet();

console.log(`PayGuard attack demo — ${ctx.mode} mode — guard ${GUARD}, agent ${AGENT}`);
if (ctx.mode === "demo") console.log("(simulated guard contract with the same rules; set DEMO=0 to run on testnet)");
console.log(`LLM: ${ctx.llm.name}\n`);

console.log("━━ Act 1: agent pays the inbox (one invoice is prompt-injected) ━━");
const outcomes = await runAgent(ctx.llm, wallet, readInbox(fileURLToPath(new URL("../inbox", import.meta.url))));

console.log("\n━━ Act 2: attacker skips the wallet and calls the guard directly ━━");
const amount = toYocto("0.2");

console.log(`\n2a. re-use a genuine allow verdict issued for ${SHOP}, re-targeted to ${BAD}`);
const shopAllow = await ctx.check({ receiver: SHOP, amountYocto: amount });
const r1 = await wallet.submit({ receiver: BAD, amount, memo: "bypass: re-targeted verdict", verdict: shopAllow.signed });

console.log(`\n2b. compromised oracle signs allow for ${BAD}`);
const r2 = await wallet.submit({ receiver: BAD, amount, memo: "bypass: compromised oracle", verdict: ctx.compromisedOracleSign(BAD, amount) });

console.log("\n━━ Summary ━━");
for (const o of outcomes) console.log(`  ${o.status.padEnd(20)} ${o.receiver} ${o.amount} NEAR  (${o.memo})`);
console.log(`  ${(r1.ok ? "SENT (BUG)" : "refused_by_contract").padEnd(20)} ${BAD} 0.2 NEAR  (2a re-targeted verdict)`);
console.log(`  ${(r2.ok ? "SENT (BUG)" : "refused_by_contract").padEnd(20)} ${BAD} 0.2 NEAR  (2b compromised oracle)`);

const leaked = outcomes.some((o) => o.receiver === BAD && o.status === "sent") || r1.ok || r2.ok;
console.log(leaked ? "\nRESULT: funds reached the attacker" : `\nRESULT: ${BAD} received nothing`);
process.exit(leaked ? 1 : 0);
