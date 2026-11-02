// Oracle verdict signing. The message format must match `verdict_message` in contract/src/lib.rs.
import { createPrivateKey, sign as edSign, randomInt } from "node:crypto";
import bs58 from "bs58";

export type Verdict = "allow" | "warn" | "block";

export interface SignedVerdict {
  verdict: Verdict;
  nonce: string; // u64 as decimal string
  expires_at: string; // ns since epoch as decimal string
  signature: string; // base64, 64 bytes
}

export interface VerdictInput {
  guard: string;
  agent: string;
  receiver: string;
  amountYocto: string;
  verdict: Verdict;
  ttlMs?: number;
}

// DER prefix that turns a raw 32-byte ed25519 seed into a PKCS#8 private key.
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function verdictMessage(
  guard: string,
  agent: string,
  receiver: string,
  amountYocto: string,
  verdict: Verdict,
  nonce: string,
  expiresAt: string,
): string {
  return `payguard-v1|${guard}|${agent}|${receiver}|${amountYocto}|${verdict}|${nonce}|${expiresAt}`;
}

/** `secretKey` is a NEAR-format key: "ed25519:<base58 of 64 bytes>". */
export function signVerdict(secretKey: string, input: VerdictInput): SignedVerdict {
  const raw = bs58.decode(secretKey.replace(/^ed25519:/, ""));
  if (raw.length !== 64 && raw.length !== 32) throw new Error("unexpected ed25519 secret key length");
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(raw.subarray(0, 32))]),
    format: "der",
    type: "pkcs8",
  });

  const nonce = (BigInt(Date.now()) * 1000n + BigInt(randomInt(1000))).toString();
  const expiresAt = (BigInt(Date.now() + (input.ttlMs ?? 5 * 60_000)) * 1_000_000n).toString();
  const msg = verdictMessage(input.guard, input.agent, input.receiver, input.amountYocto, input.verdict, nonce, expiresAt);

  return {
    verdict: input.verdict,
    nonce,
    expires_at: expiresAt,
    signature: edSign(null, Buffer.from(msg, "utf8"), key).toString("base64"),
  };
}
