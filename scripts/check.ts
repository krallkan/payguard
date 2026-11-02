// CLI risk check: npm run check -- <receiver> [amountNEAR]
// Demo mode uses fixtures; DEMO=0 uses live testnet data (NEAR RPC, NearBlocks, guard views).
import "dotenv/config";
import { createContext } from "../packages/app/src/context.js";
import { toYocto } from "../packages/agent/src/wallet.js";

const [receiver, amountNear = "0.1"] = process.argv.slice(2);
if (!receiver) {
  console.error("usage: npm run check -- <receiver> [amountNEAR]");
  process.exit(1);
}

const ctx = await createContext();
const r = await ctx.check({ receiver, amountYocto: toYocto(amountNear) });
console.log(`${r.verdict.toUpperCase()}  ${receiver}  ${amountNear} NEAR  (${ctx.mode} mode)`);
for (const reason of r.reasons) console.log(`  - [${reason.level}] ${reason.text}`);
const { knownReceivers, blockReports, ...facts } = r.signals;
console.log(`  signals: ${JSON.stringify(facts)}`);
