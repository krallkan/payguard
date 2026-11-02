//! PayGuard guard contract.
//!
//! Holds an AI agent's funds. The agent (signing with a function-call key scoped to this
//! contract) can only move funds through `pay`, and `pay` only releases funds when it carries a
//! verdict signed by the off-chain risk oracle for that exact receiver, amount and nonce.
//! Hard limits and a shared blocklist are enforced here even when the oracle says `allow`.

use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::store::{IterableMap, IterableSet, LookupSet, Vector};
use near_sdk::{
    AccountId, BorshStorageKey, CurveType, Gas, NearToken, PanicOnDefault, Promise, PromiseError,
    PublicKey, env, near, require,
};

const NS_PER_DAY: u64 = 86_400 * 1_000_000_000;
/// Kept on the contract so it can always pay for its own storage.
const BALANCE_RESERVE: NearToken = NearToken::from_millinear(100);
/// Deposit required from reporters other than the owner and the agent (anti-spam, pays storage).
const REPORT_DEPOSIT: NearToken = NearToken::from_millinear(10);
const MAX_REPORTS_PER_ACCOUNT: u32 = 20;
const MAX_TEXT_LEN: usize = 280;
const CALLBACK_GAS: Gas = Gas::from_tgas(5);

#[near]
#[derive(BorshStorageKey)]
enum StorageKey {
    Nonces,
    Pending,
    Blocklist,
    Log,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Verdict {
    Allow,
    Warn,
    Block,
}

impl Verdict {
    fn as_str(&self) -> &'static str {
        match self {
            Verdict::Allow => "allow",
            Verdict::Warn => "warn",
            Verdict::Block => "block",
        }
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    /// Transfer submitted; becomes `Failed` if the transfer receipt fails.
    Sent,
    /// `warn` verdict: waiting for the owner.
    Pending,
    Rejected,
    Failed,
}

/// The oracle's answer as the agent submits it.
#[near(serializers = [json])]
pub struct SignedVerdict {
    pub verdict: Verdict,
    pub nonce: U64,
    /// Nanoseconds since epoch.
    pub expires_at: U64,
    /// ed25519 signature (64 bytes) over `verdict_message(...)`.
    pub signature: Base64VecU8,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Payment {
    pub id: u64,
    pub receiver: AccountId,
    pub amount: NearToken,
    pub verdict: Verdict,
    pub status: Status,
    pub memo: String,
    pub created_at: U64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Report {
    pub reporter: AccountId,
    pub reason: String,
    pub evidence: String,
    pub at: U64,
}

#[near(serializers = [json])]
pub struct Config {
    pub owner: AccountId,
    pub agent: AccountId,
    pub oracle_pk: PublicKey,
    pub per_tx_limit: NearToken,
    pub daily_limit: NearToken,
    pub spent_today: NearToken,
    pub frozen: bool,
    pub available: NearToken,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    agent: AccountId,
    oracle_pk: PublicKey,
    per_tx_limit: NearToken,
    daily_limit: NearToken,
    day_index: u64,
    spent_today: NearToken,
    frozen: bool,
    used_nonces: LookupSet<u64>,
    pending: IterableSet<u64>,
    blocklist: IterableMap<AccountId, Vec<Report>>,
    log: Vector<Payment>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner: AccountId,
        agent: AccountId,
        oracle_pk: PublicKey,
        per_tx_limit: NearToken,
        daily_limit: NearToken,
    ) -> Self {
        require!(oracle_pk.curve_type() == CurveType::ED25519, "oracle key must be ed25519");
        Self {
            owner,
            agent,
            oracle_pk,
            per_tx_limit,
            daily_limit,
            day_index: env::block_timestamp() / NS_PER_DAY,
            spent_today: NearToken::from_yoctonear(0),
            frozen: false,
            used_nonces: LookupSet::new(StorageKey::Nonces),
            pending: IterableSet::new(StorageKey::Pending),
            blocklist: IterableMap::new(StorageKey::Blocklist),
            log: Vector::new(StorageKey::Log),
        }
    }

    // ---------------------------------------------------------------- agent

    /// Pay `amount` to `receiver`. Only the agent can call this; the agent's function-call key
    /// cannot attach deposits, so the funds always come from this contract's balance.
    pub fn pay(
        &mut self,
        receiver: AccountId,
        amount: NearToken,
        memo: Option<String>,
        verdict: SignedVerdict,
    ) -> Option<Promise> {
        require!(!self.frozen, "guard is frozen");
        require!(env::predecessor_account_id() == self.agent, "only the agent can pay");
        require!(!amount.is_zero(), "amount must be positive");
        let memo = memo.unwrap_or_default();
        require!(memo.len() <= MAX_TEXT_LEN, "memo too long");

        self.verify_verdict(&receiver, amount, &verdict);
        require!(verdict.verdict != Verdict::Block, "blocked by risk oracle");
        require!(!self.blocklist.contains_key(&receiver), "receiver is on the shared blocklist");
        require!(amount <= self.per_tx_limit, "amount exceeds per-transaction limit");

        let id = self.log.len() as u64;
        let mut payment = Payment {
            id,
            receiver,
            amount,
            verdict: verdict.verdict,
            status: Status::Pending,
            memo,
            created_at: U64(env::block_timestamp()),
        };

        if verdict.verdict == Verdict::Warn {
            self.pending.insert(id);
            emit("payment_pending", &payment);
            self.log.push(payment);
            return None;
        }

        let promise = self.send(&payment);
        payment.status = Status::Sent;
        emit("payment_sent", &payment);
        self.log.push(payment);
        Some(promise)
    }

    /// Report a receiver to the shared blocklist. Free for the owner and the agent; anyone else
    /// attaches `REPORT_DEPOSIT` to pay for storage.
    #[payable]
    pub fn report(&mut self, receiver: AccountId, reason: String, evidence: String) {
        let reporter = env::predecessor_account_id();
        if reporter != self.owner && reporter != self.agent {
            require!(env::attached_deposit() >= REPORT_DEPOSIT, "attach 0.01 NEAR to report");
        }
        require!(reason.len() <= MAX_TEXT_LEN && evidence.len() <= MAX_TEXT_LEN, "text too long");
        require!(!reason.is_empty(), "reason is required");

        let report = Report { reporter, reason, evidence, at: U64(env::block_timestamp()) };
        emit_json("receiver_reported", &near_sdk::serde_json::json!({ "receiver": receiver, "report": report }));
        let reports = self.blocklist.entry(receiver).or_default();
        require!((reports.len() as u32) < MAX_REPORTS_PER_ACCOUNT, "too many reports for this account");
        reports.push(report);
    }

    #[private]
    pub fn on_transfer(&mut self, id: u64, #[callback_result] result: Result<(), PromiseError>) {
        if result.is_ok() {
            return;
        }
        let payment = self.log.get_mut(id as u32).expect("unknown payment");
        payment.status = Status::Failed;
        let (amount, created_at) = (payment.amount, payment.created_at.0);
        let snapshot = payment.clone();
        // Refund the daily budget only if the payment was counted today.
        if created_at / NS_PER_DAY == self.day_index {
            self.spent_today = self.spent_today.saturating_sub(amount);
        }
        emit("payment_failed", &snapshot);
    }

    // ---------------------------------------------------------------- owner

    /// Approve a `warn` payment. Limits and the blocklist are checked again at approval time.
    pub fn approve_pending(&mut self, id: u64) -> Promise {
        self.assert_owner();
        require!(!self.frozen, "guard is frozen");
        require!(self.pending.remove(&id), "no pending payment with this id");
        let payment = self.log.get(id as u32).expect("unknown payment").clone();
        require!(!self.blocklist.contains_key(&payment.receiver), "receiver is on the shared blocklist");
        require!(payment.amount <= self.per_tx_limit, "amount exceeds per-transaction limit");

        let promise = self.send(&payment);
        let stored = self.log.get_mut(id as u32).unwrap();
        stored.status = Status::Sent;
        emit("payment_sent", stored);
        promise
    }

    pub fn reject_pending(&mut self, id: u64) {
        self.assert_owner();
        require!(self.pending.remove(&id), "no pending payment with this id");
        let stored = self.log.get_mut(id as u32).expect("unknown payment");
        stored.status = Status::Rejected;
        emit("payment_rejected", stored);
    }

    pub fn set_limits(&mut self, per_tx_limit: NearToken, daily_limit: NearToken) {
        self.assert_owner();
        self.per_tx_limit = per_tx_limit;
        self.daily_limit = daily_limit;
    }

    pub fn set_oracle_pk(&mut self, oracle_pk: PublicKey) {
        self.assert_owner();
        require!(oracle_pk.curve_type() == CurveType::ED25519, "oracle key must be ed25519");
        self.oracle_pk = oracle_pk;
    }

    pub fn set_agent(&mut self, agent: AccountId) {
        self.assert_owner();
        self.agent = agent;
    }

    pub fn set_frozen(&mut self, frozen: bool) {
        self.assert_owner();
        self.frozen = frozen;
    }

    pub fn remove_from_blocklist(&mut self, receiver: AccountId) {
        self.assert_owner();
        self.blocklist.remove(&receiver);
    }

    pub fn withdraw(&mut self, amount: NearToken) -> Promise {
        self.assert_owner();
        require!(amount <= self.available(), "not enough available balance");
        Promise::new(self.owner.clone()).transfer(amount)
    }

    // ---------------------------------------------------------------- views

    /// The exact bytes (UTF-8) the oracle signs. Exposed so off-chain code can mirror it.
    pub fn verdict_message(
        &self,
        agent: AccountId,
        receiver: AccountId,
        amount: NearToken,
        verdict: Verdict,
        nonce: U64,
        expires_at: U64,
    ) -> String {
        format!(
            "payguard-v1|{}|{}|{}|{}|{}|{}|{}",
            env::current_account_id(),
            agent,
            receiver,
            amount.as_yoctonear(),
            verdict.as_str(),
            nonce.0,
            expires_at.0
        )
    }

    pub fn get_config(&self) -> Config {
        let today = env::block_timestamp() / NS_PER_DAY;
        Config {
            owner: self.owner.clone(),
            agent: self.agent.clone(),
            oracle_pk: self.oracle_pk.clone(),
            per_tx_limit: self.per_tx_limit,
            daily_limit: self.daily_limit,
            spent_today: if today == self.day_index { self.spent_today } else { NearToken::from_yoctonear(0) },
            frozen: self.frozen,
            available: self.available(),
        }
    }

    pub fn get_payments(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Payment> {
        let from = from_index.unwrap_or(0) as u32;
        let limit = limit.unwrap_or(50).min(100) as u32;
        (from..self.log.len().min(from.saturating_add(limit)))
            .filter_map(|i| self.log.get(i).cloned())
            .collect()
    }

    pub fn get_pending(&self) -> Vec<Payment> {
        self.pending.iter().filter_map(|id| self.log.get(*id as u32).cloned()).collect()
    }

    pub fn get_blocklist(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<(AccountId, Vec<Report>)> {
        self.blocklist
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50).min(100) as usize)
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect()
    }

    pub fn is_blocked(&self, account_id: AccountId) -> bool {
        self.blocklist.contains_key(&account_id)
    }

    pub fn is_nonce_used(&self, nonce: U64) -> bool {
        self.used_nonces.contains(&nonce.0)
    }

    // ---------------------------------------------------------------- internal

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only the owner");
    }

    fn available(&self) -> NearToken {
        let storage = env::storage_byte_cost().saturating_mul(env::storage_usage() as u128);
        env::account_balance().saturating_sub(storage).saturating_sub(BALANCE_RESERVE)
    }

    fn verify_verdict(&mut self, receiver: &AccountId, amount: NearToken, v: &SignedVerdict) {
        require!(v.expires_at.0 > env::block_timestamp(), "verdict expired");
        require!(!self.used_nonces.contains(&v.nonce.0), "verdict nonce already used");
        let sig: [u8; 64] = v.signature.0.as_slice().try_into().unwrap_or_else(|_| env::panic_str("signature must be 64 bytes"));
        let pk: [u8; 32] = self.oracle_pk.as_bytes()[1..].try_into().unwrap();
        let msg = self.verdict_message(
            env::predecessor_account_id(),
            receiver.clone(),
            amount,
            v.verdict,
            v.nonce,
            v.expires_at,
        );
        require!(env::ed25519_verify(&sig, msg.as_bytes(), &pk), "invalid oracle signature");
        self.used_nonces.insert(v.nonce.0);
    }

    /// Checks daily budget and balance, books the spend and starts the transfer.
    fn send(&mut self, payment: &Payment) -> Promise {
        let today = env::block_timestamp() / NS_PER_DAY;
        if today != self.day_index {
            self.day_index = today;
            self.spent_today = NearToken::from_yoctonear(0);
        }
        let spent = self.spent_today.saturating_add(payment.amount);
        require!(spent <= self.daily_limit, "amount exceeds daily limit");
        require!(payment.amount <= self.available(), "not enough available balance");
        self.spent_today = spent;

        Promise::new(payment.receiver.clone())
            .transfer(payment.amount)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_transfer(payment.id))
    }
}

fn emit(event: &str, payment: &Payment) {
    emit_json(event, payment);
}

/// NEP-297 style event log.
fn emit_json<T: near_sdk::serde::Serialize>(event: &str, data: &T) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        near_sdk::serde_json::json!({ "standard": "payguard", "version": "1.0.0", "event": event, "data": [data] })
    ));
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::test_utils::{VMContextBuilder, accounts};
    use near_sdk::testing_env;

    const NOW: u64 = 1_800_000_000_000_000_000;

    fn oracle() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn oracle_pk() -> PublicKey {
        let mut bytes = vec![0u8]; // curve type ed25519
        bytes.extend_from_slice(oracle().verifying_key().as_bytes());
        PublicKey::try_from(bytes).unwrap()
    }

    // accounts(0)=alice owner, (1)=bob agent, (2)=charlie shop, (3)=danny bad
    fn ctx(predecessor: AccountId, deposit: NearToken) {
        testing_env!(VMContextBuilder::new()
            .current_account_id("guard.testnet".parse().unwrap())
            .predecessor_account_id(predecessor)
            .attached_deposit(deposit)
            .account_balance(NearToken::from_near(10))
            .block_timestamp(NOW)
            .build());
    }

    fn setup() -> Contract {
        ctx(accounts(0), NearToken::from_near(0));
        Contract::new(accounts(0), accounts(1), oracle_pk(), NearToken::from_near(1), NearToken::from_near(2))
    }

    fn sign(c: &Contract, receiver: &AccountId, amount: NearToken, verdict: Verdict, nonce: u64) -> SignedVerdict {
        let expires_at = U64(NOW + 60_000_000_000);
        let msg = c.verdict_message(accounts(1), receiver.clone(), amount, verdict, U64(nonce), expires_at);
        SignedVerdict {
            verdict,
            nonce: U64(nonce),
            expires_at,
            signature: Base64VecU8(oracle().sign(msg.as_bytes()).to_bytes().to_vec()),
        }
    }

    fn as_agent() {
        ctx(accounts(1), NearToken::from_near(0));
    }

    #[test]
    fn allow_pays_and_books_spend() {
        let mut c = setup();
        as_agent();
        let amt = NearToken::from_millinear(500);
        let v = sign(&c, &accounts(2), amt, Verdict::Allow, 1);
        assert!(c.pay(accounts(2), amt, Some("invoice 1".into()), v).is_some());
        let p = &c.get_payments(None, None)[0];
        assert_eq!(p.status, Status::Sent);
        assert_eq!(c.get_config().spent_today, amt);
        assert!(c.is_nonce_used(U64(1)));
    }

    #[test]
    #[should_panic(expected = "blocked by risk oracle")]
    fn block_verdict_is_refused() {
        let mut c = setup();
        as_agent();
        let amt = NearToken::from_millinear(500);
        let v = sign(&c, &accounts(3), amt, Verdict::Block, 1);
        c.pay(accounts(3), amt, None, v);
    }

    #[test]
    #[should_panic(expected = "receiver is on the shared blocklist")]
    fn blocklist_beats_allow() {
        let mut c = setup();
        c.report(accounts(3), "phishing".into(), "https://example.com/evidence".into());
        as_agent();
        let amt = NearToken::from_millinear(500);
        let v = sign(&c, &accounts(3), amt, Verdict::Allow, 1);
        c.pay(accounts(3), amt, None, v);
    }

    #[test]
    #[should_panic(expected = "invalid oracle signature")]
    fn verdict_for_other_receiver_is_rejected() {
        let mut c = setup();
        as_agent();
        let amt = NearToken::from_millinear(500);
        // Valid allow for the shop, replayed for the attacker.
        let v = sign(&c, &accounts(2), amt, Verdict::Allow, 1);
        c.pay(accounts(3), amt, None, v);
    }

    #[test]
    #[should_panic(expected = "invalid oracle signature")]
    fn tampered_amount_is_rejected() {
        let mut c = setup();
        as_agent();
        let v = sign(&c, &accounts(2), NearToken::from_millinear(100), Verdict::Allow, 1);
        c.pay(accounts(2), NearToken::from_millinear(900), None, v);
    }

    #[test]
    #[should_panic(expected = "verdict nonce already used")]
    fn replay_is_rejected() {
        let mut c = setup();
        as_agent();
        let amt = NearToken::from_millinear(100);
        let v1 = sign(&c, &accounts(2), amt, Verdict::Allow, 1);
        let v2 = sign(&c, &accounts(2), amt, Verdict::Allow, 1);
        c.pay(accounts(2), amt, None, v1);
        c.pay(accounts(2), amt, None, v2);
    }

    #[test]
    #[should_panic(expected = "only the agent can pay")]
    fn only_agent_can_pay() {
        let mut c = setup();
        ctx(accounts(3), NearToken::from_near(0));
        let amt = NearToken::from_millinear(100);
        let v = sign(&c, &accounts(2), amt, Verdict::Allow, 1);
        c.pay(accounts(2), amt, None, v);
    }

    #[test]
    #[should_panic(expected = "amount exceeds per-transaction limit")]
    fn per_tx_limit() {
        let mut c = setup();
        as_agent();
        let amt = NearToken::from_millinear(1500);
        let v = sign(&c, &accounts(2), amt, Verdict::Allow, 1);
        c.pay(accounts(2), amt, None, v);
    }

    #[test]
    #[should_panic(expected = "amount exceeds daily limit")]
    fn daily_limit() {
        let mut c = setup();
        as_agent();
        let amt = NearToken::from_millinear(900);
        for n in 1..=3 {
            let v = sign(&c, &accounts(2), amt, Verdict::Allow, n);
            c.pay(accounts(2), amt, None, v);
        }
    }

    #[test]
    fn warn_waits_for_owner_then_approve() {
        let mut c = setup();
        as_agent();
        let amt = NearToken::from_millinear(300);
        let v = sign(&c, &accounts(2), amt, Verdict::Warn, 1);
        assert!(c.pay(accounts(2), amt, None, v).is_none());
        assert_eq!(c.get_pending().len(), 1);
        assert_eq!(c.get_config().spent_today, NearToken::from_yoctonear(0));

        ctx(accounts(0), NearToken::from_near(0));
        let _ = c.approve_pending(0);
        assert!(c.get_pending().is_empty());
        assert_eq!(c.get_payments(None, None)[0].status, Status::Sent);
        assert_eq!(c.get_config().spent_today, amt);
    }

    #[test]
    fn warn_then_reject() {
        let mut c = setup();
        as_agent();
        let amt = NearToken::from_millinear(300);
        let v = sign(&c, &accounts(2), amt, Verdict::Warn, 1);
        c.pay(accounts(2), amt, None, v);
        ctx(accounts(0), NearToken::from_near(0));
        c.reject_pending(0);
        assert_eq!(c.get_payments(None, None)[0].status, Status::Rejected);
    }

    #[test]
    #[should_panic(expected = "only the owner")]
    fn agent_cannot_approve_its_own_warn() {
        let mut c = setup();
        as_agent();
        let amt = NearToken::from_millinear(300);
        let v = sign(&c, &accounts(2), amt, Verdict::Warn, 1);
        c.pay(accounts(2), amt, None, v);
        let _ = c.approve_pending(0);
    }

    #[test]
    #[should_panic(expected = "attach 0.01 NEAR to report")]
    fn strangers_pay_to_report() {
        let mut c = setup();
        ctx(accounts(4), NearToken::from_near(0));
        c.report(accounts(3), "spam".into(), "".into());
    }

    #[test]
    fn stranger_report_with_deposit() {
        let mut c = setup();
        ctx(accounts(4), REPORT_DEPOSIT);
        c.report(accounts(3), "drainer".into(), "tx 123".into());
        assert!(c.is_blocked(accounts(3)));
        assert_eq!(c.get_blocklist(None, None)[0].1[0].reporter, accounts(4));
    }

    #[test]
    #[should_panic(expected = "guard is frozen")]
    fn frozen_blocks_payments() {
        let mut c = setup();
        c.set_frozen(true);
        as_agent();
        let amt = NearToken::from_millinear(100);
        let v = sign(&c, &accounts(2), amt, Verdict::Allow, 1);
        c.pay(accounts(2), amt, None, v);
    }

    #[test]
    #[should_panic(expected = "verdict expired")]
    fn expired_verdict() {
        let mut c = setup();
        let amt = NearToken::from_millinear(100);
        let v = sign(&c, &accounts(2), amt, Verdict::Allow, 1);
        testing_env!(VMContextBuilder::new()
            .current_account_id("guard.testnet".parse().unwrap())
            .predecessor_account_id(accounts(1))
            .account_balance(NearToken::from_near(10))
            .block_timestamp(NOW + 120_000_000_000)
            .build());
        c.pay(accounts(2), amt, None, v);
    }
}
