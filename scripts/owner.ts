// Owner console CLI (testnet): npm run owner -- <pending|approve <id>|reject <id>|freeze|unfreeze>
// Demo mode keeps state in the web console's process, so use the console's buttons there.
import "dotenv/config";
import { createContext } from "../packages/app/src/context.js";

const [cmd, arg] = process.argv.slice(2);
const ctx = await createContext();
if (ctx.mode === "demo") console.log("note: demo mode starts a fresh simulated guard; set DEMO=0 to act on testnet");
const owner = ctx.owner;
const near = (y: string) => (Number(BigInt(y) / 10n ** 20n) / 10_000).toString();

switch (cmd) {
  case "pending": {
    const { pending } = await owner.state();
    if (!pending.length) console.log("nothing waiting");
    for (const p of pending) console.log(`#${p.id}  ${p.receiver}  ${near(p.amount)} NEAR  "${p.memo}"`);
    break;
  }
  case "approve":
  case "reject":
    console.log(await owner[cmd](Number(arg)));
    break;
  case "freeze":
  case "unfreeze":
    console.log(await owner.freeze(cmd === "freeze"));
    break;
  default:
    console.log("usage: npm run owner -- <pending|approve <id>|reject <id>|freeze|unfreeze>");
    process.exit(1);
}
