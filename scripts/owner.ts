// Owner console CLI: npm run owner -- <pending|approve <id>|reject <id>|freeze|unfreeze>
import "dotenv/config";
import { OwnerConsole } from "../packages/agent/src/owner.js";

const owner = new OwnerConsole(process.env.GUARD_CONTRACT_ID!, process.env.OWNER_ACCOUNT_ID!, process.env.OWNER_CONSOLE_KEY);
const [cmd, arg] = process.argv.slice(2);
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
