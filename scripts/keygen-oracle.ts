// Generates the risk oracle's ed25519 key and stores it in .env. Prints only the public key.
import { readFileSync, writeFileSync } from "node:fs";
import { generateKey } from "near-kit";

const path = new URL("../.env", import.meta.url);
let env = readFileSync(path, "utf8");

const existing = env.match(/^ORACLE_PRIVATE_KEY=(ed25519:\S+)/m);
if (existing) {
  const pub = env.match(/^ORACLE_PUBLIC_KEY=(\S+)/m)?.[1];
  console.log(`ORACLE_PRIVATE_KEY already set. Public key: ${pub ?? "(missing ORACLE_PUBLIC_KEY)"}`);
  process.exit(0);
}

const key = generateKey();
const pub = key.publicKey.toString();
const set = (name: string, value: string) => {
  const re = new RegExp(`^${name}=.*$`, "m");
  env = re.test(env) ? env.replace(re, `${name}=${value}`) : `${env.trimEnd()}\n${name}=${value}\n`;
};
set("ORACLE_PRIVATE_KEY", key.secretKey);
set("ORACLE_PUBLIC_KEY", pub);
writeFileSync(path, env);
console.log(`Oracle key written to .env. Public key: ${pub}`);
