# NEAR HACKATHON 2026 — Claude Code Proje Talimatları

> Bu dosyayı proje klasörünün köküne `CLAUDE.md` adıyla koy. Claude Code her oturumda otomatik okur.
> Sahibi: **Taşkın** (tek kişilik takım, takım lideri). Konuşma dili: **Türkçe**. Kod, commit mesajları ve README: **İngilizce** (jüri İngilizce okuyor).

---

## 0. Hızlı Özet

| Konu | Bilgi |
|---|---|
| Başlangıç | 1 Kasım 2026 00:00 UTC (03:00 TR) |
| **Son teslim** | **14 Kasım 2026 23:59 UTC → 15 Kasım 02:59 TR saati** |
| Jüri | 16–18 Kasım 2026 |
| Kayıt | Gerekmiyor |
| Takım | Tek kişi veya çok kişi |
| Ödüller | Her kategori: 1.lik $10K, 2.lik $3K, 3.lük $2K · Büyük ödül: $55K · **Hepsi NEAR token olarak** ödenir |
| Teslim sayısı | Takım başına **1 teslim**, gönderildikten sonra **düzenlenemez** |
| Jüri notu | Jüride **AI jüriler (Claude Code ve Codex)** var → README makinenin takip edebileceği şekilde yazılmalı |

**Resmi kaynaklar (her zaman canlı halini oku, kurallar değişebilir):**
- Site: https://nearhackathon.com
- Ajan talimatları ve teslim API'si: https://nearhackathon.com/HACKATHON.md
- Başlangıç promptları: https://github.com/nearai/near-hackathon-prompt-examples
- NEAR dokümanları (LLM için): https://docs.near.org/llms.txt
- NEAR Intents dokümanları (LLM için): https://docs.near-intents.org/llms.txt
- Soru / takım arkadaşı: NEAR Discord → discord.gg/nearprotocol

---

## 1. Claude İçin Kesin Kurallar (her oturumda geçerli)

1. **Önce oku, sonra yaz.** İlk oturumda `https://nearhackathon.com/HACKATHON.md` dosyasını baştan sona oku. İçindeki **"never without the human's confirmation"** listesine harfiyen uy.
2. **Tahmin etme.** Kontrat adresleri, endpoint'ler, SDK sürümleri ve chain ID'ler her zaman dokümandan bakılır. Bulamazsan Taşkın'a sor.
3. **Önce testnet.** Her şey önce testnet'te çalışacak. Mainnet'e geçiş Taşkın'ın açık onayı ile olur.
4. **Anahtarlar `.env` içinde.** Repoya asla private key, seed phrase veya API anahtarı girmez. `.env` dosyası `.gitignore` içinde olmalı, repoda sadece `.env.example` bulunur. Commit atmadan önce sırları tara.
5. **Full-access key kullanma.** Ajanlar / servisler mümkünse tek kontrata kısıtlı **function-call access key** ile imzalar.
6. **Hackathon süresinde yazılan kod.** Proje 1–14 Kasım arasında geliştirilmeli. Hazır kütüphane kullanılabilir. Önceden yazılmış kendi kodum varsa README'de açıkça ayrılır.
7. **Checkpoint'lerde dur.** Aşağıdaki her fazın sonunda ne yaptığını özetle ve Taşkın'ın "devam" demesini bekle.
8. **Teslim (submission) asla otomatik gönderilmez.** Teslim API'si kullanılacaksa, gönderilecek payload'ın tamamını Taşkın'a göster ve açık onay al.
9. **README ilk günden yazılır** ve her özellikle birlikte güncellenir (bkz. Bölüm 6).

---

## 2. Kurulum (Faz 0 — ilk oturum)

Claude şu adımları sırayla yapar:

```bash
# 1) NEAR agent skill'lerini kur
npx skills add near/agent-skills
#    (içerik: near-ai-cloud, near-api-js, near-dapp, near-intents, near-kit, near-smart-contracts)
#    Tek skill için: npx skills add near/agent-skills --skill near-intents

# 2) Git repo + temel dosyalar
git init
printf ".env\nnode_modules/\n.near-credentials/\n*.key\n" > .gitignore
touch .env.example README.md
```

**Taşkın'ın yapacakları (Claude yapmaz):**
- [x] Testnet hesabı aç (ör. `taskin-hack.testnet`), anahtarları sadece `.env` içine koy
- [x] **Mainnet NEAR hesabı** hazırla (ödül bu adrese gelir). Private key / seed phrase kimseyle ve Claude ile paylaşılmaz
- [ ] Gerekiyorsa API anahtarları al (NEAR AI Cloud, 1Click / Intents Explorer JWT, Agent API demo key)
- [x] GitHub'da **public** repo aç (https://github.com/krallkan/payguard)

**Faz 0 checkpoint:** Claude, HACKATHON.md'yi okuduğunu kanıtlamak için 13 kategori id'sini listeler ve kategori seçimini bekler.

---

## 3. Kategoriler (Tracks)

Formda **birden fazla kategori seçilebilir**. `open` her kategoriyle birlikte seçilebilir.

| # | id | Kategori | Ne isteniyor | Ana teknoloji |
|---|---|---|---|---|
| 01 | `defi` | Unstoppable DeFi | Zincirler arası takas, vault, trading ajanları | NEAR Intents, 1Click API, Chain Signatures |
| 02 | `thesis` | Investment Thesis | NEAR için tekrar üretilebilir veri analizi ve dashboard | BigQuery public dataset, Intents Explorer API |
| 03 | `privacy` | Privacy & Private AI | TEE içinde çalışan, kanıtlanabilir gizli AI | NEAR AI Cloud (OpenAI uyumlu API) |
| 04 | `business` | Autonomous Business | Kendi kasasını yöneten AI işletmesi | AI ajanları, Intents, OutLayer |
| 05 | `swarms` | AI Swarms | Ajanlar arası pazar, ihale, toplu alım | Multi-agent, sub-account'lar |
| 06 | `security` | AI Security & Defense | Harcama limiti, politika motoru, dolandırıcılık tespiti | Function-call key, TEE attestation |
| 07 | `agents` | Agent Economy | Kazanan, harcayan, başka ajan kiralayan ajanlar | Agent API, x402 / PingPay, Intents |
| 08 | `realworld` | Real-World Money | Fatura, maaş, havale, esnaf ödemesi — gerçek şirket kullanabilmeli | Stablecoin, 1Click, meta transaction relayer |
| 09 | `games` | Games With Real Economies | Cüzdanlı NPC'ler, oyuncu pazarları | NEP-245, sosyal login |
| 10 | `nfts` | NFTs That Do Something | Kendi cüzdanı olan, gelir toplayan NFT'ler | NEP-171, sub-account |
| 11 | `memecoins` | Memecoins With Mechanics | Kuralı kontratta olan memecoin mekanikleri | NEP-141 |
| 12 | `social` | Social Money | DAO kasası üzerinde ödül panosu, itibar sistemi | Sputnik DAO, Trezu |
| 13 | `open` | Open Innovation | Hiçbir kategoriye uymayan yeni fikir | Serbest |

Her kategorinin hazır başlangıç promptu: `https://github.com/nearai/near-hackathon-prompt-examples/tree/main/tracks`

### Seçilen Fikir

- **B) `security` + `agents` — Ajan ödeme güvenlik kontrolü:** Bir ajan para göndermeden önce alıcıyı sorgular → `allow / warn / block` + gerekçe. `warn` durumunda insana onay için bildirim (SMS/mesaj) gider. Prompt-injection saldırı demosu. Tasarım: `docs/DESIGN.md`.

**Seçim kriteri:** 14 günde tek kişiyle **çalışan demo** çıkarabileceğin, jürinin parasız deneyebileceği (dry-run / testnet) en küçük kapsam.

---

## 4. Faz Planı (14 gün)

Tarihler TR saatiyle. Her faz sonunda **checkpoint = Claude durur, özetler, onay bekler.**

| Faz | Tarih | Hedef | Checkpoint çıktısı |
|---|---|---|---|
| 0 | 1–2 Kas | Kurulum, HACKATHON.md, kategori seçimi | 13 track id + seçilen kategori(ler) |
| 1 | 2–3 Kas | Tasarım: problem, kullanıcı, mimari (metin + sıralama diyagramı), dosya yapısı | `docs/DESIGN.md` + Taşkın onayı |
| 2 | 3–5 Kas | En küçük uçtan uca akış (ör. 1 ödeme / 1 sorgu) testnet'te çalışıyor | Terminal çıktısı + explorer linki |
| 3 | 5–9 Kas | Ana özellikler + basit web arayüzü + hata durumları (REFUNDED, FAILED vb.) | Ekran görüntüsü + çalışan demo |
| 4 | 9–11 Kas | **Dry-run / demo modu** (jüri parasız denesin), testler, örnek veriler | `npm run demo` tek komutla çalışıyor |
| 5 | 11–12 Kas | README (AI jüri formatı), mimari bölümü, sınırlar/bilinen sorunlar | README son hali |
| 6 | 12–13 Kas | Demo videosu / ekran görüntüleri + X demo gönderisi | X gönderi linki |
| 7 | 13–14 Kas | Son kontrol listesi + teslim | Teslim onayı |

**Kural:** Faz 2 bitmeden yeni özellik eklenmez. Zaman sıkışırsa kapsam küçülür, teslim tarihi değişmez.

---

## 5. Kategori Promptunu Kullanma

Faz 0 bittikten sonra Taşkın seçtiği kategorinin promptunu yapıştırır. Şablon:

```text
Track: <Kategori adı> (id: <id>).

Build [<fikrin tek cümlelik özeti>].

Requirements:
- <zorunlu teknoloji / skill>
- <kullanıcının fonlarının her adımda nerede olduğu görünür olsun>
- <küçük web arayüzü>
- <jüri için dry-run / demo modu, para gerektirmesin>
- Stretch: <ekstra>

Read <ilgili doküman> first, tell me which parts it already handles,
then propose a file layout and wait for my OK.
```

---

## 6. README Şablonu (AI jüri için)

Jüride Claude Code ve Codex var. README pazarlama metni değil, **"X yap, Y'yi gör"** adımları içermeli.

```markdown
# <Project Name>

Built at NEAR HACKATHON 2026 (Nov 1–14). Tracks: <id1>, <id2>

## What it is
One paragraph. No marketing copy.

## The problem
Who has it, why current options fail.

## How NEAR is used
- NEAR Intents / 1Click: <exactly what for>
- Contract: <account id on testnet> — <what it does>
- Other: <Chain Signatures / AI Cloud / ...>

## Try it in 5 minutes (no funds needed)
1. `git clone <repo> && cd <repo>`
2. `cp .env.example .env` (demo values work as-is)
3. `npm install && npm run demo`
4. Open http://localhost:3000 → click "<button>" → you should see "<expected result>"
5. Run `npm test` → you should see "<N> passing"

## Architecture
Short text diagram or sequence of one full flow.

## Limits and known issues
Honest list. What is mocked, what is testnet-only, security assumptions.

## Pre-existing code
None / or: list what existed before Nov 1 and what was built during the hackathon.
```

---

## 7. X Demo Gönderisi (zorunlu)

Şartlar: X'te public gönderi + **NEAR HACKATHON'da yapıldığı yazmalı** + **@NEARProtocol ve #NEARHackathon etiketleri** + **video veya ekran görüntüsü** eklenmeli.

Taslak (Taşkın kendi hesabından paylaşır, Claude paylaşmaz):

```text
Built <Project Name> at NEAR HACKATHON @NEARProtocol #NEARHackathon 🚀

<1 sentence: what it does>
<1 sentence: how NEAR Intents / <tech> powers it>

Repo: <github link>
[video / screenshots attached]
```

---

## 8. Teslim Öncesi Kontrol Listesi

Tek teslim hakkı var, sonradan düzenlenemez. Hepsi ✅ olmadan gönderilmez.

- [x] Repo **public** ve README'de "do X, see Y" adımları var
- [x] Demo modu temiz bir klonda çalışıyor (2 Kasım'da test edildi)
- [x] Repo geçmişinin hiçbir yerinde anahtar/sır yok (2 Kasım tarandı) (`git log -p | grep -iE "private|seed|secret|key"` ile kontrol)
- [x] X demo gönderisi yayında: https://x.com/blokceyn/status/2117212782319824913
- [x] Ödül için **mainnet NEAR hesabı** hazır (`kralkan.near`)
- [x] Projeye uyan **tüm kategoriler** seçildi (security, agents)
- [x] "What did you build?" metni hazır (20–2000 karakter: problem, nasıl yapıldı, NEAR'ın rolü)
- [x] LICENSE dosyası repoda (MIT)
- [x] Teslim **14 Kasım 23:59 UTC'den (15 Kasım 02:59 TR) önce** — GÖNDERİLDİ 2 Kasım 2026, API HTTP 201. Tekrar gönderme.

**Teslim formu alanları:** Proje adı · Takım lideri · E-posta · Takım büyüklüğü · Kategori(ler) · NEAR cüzdan adresi · Public GitHub linki · Public X demo gönderi linki · "What did you build?" açıklaması · Onay metni (HACKATHON.md'deki cümle Taşkın'a aynen okunur)

**Teslim yolu:** https://nearhackathon.com/#apply formu, ya da HACKATHON.md'deki teslim API'si (Claude payload'ı gösterir → Taşkın onaylar → sonra gönderilir).

---

## 9. Oturum Başlangıç Rutini (Claude için)

Her yeni oturumda:
1. Bu dosyayı ve `docs/DESIGN.md` (varsa) dosyasını oku
2. Bugünün tarihine göre hangi fazda olunduğunu ve teslime kaç gün kaldığını söyle
3. Bir önceki checkpoint'in durumunu özetle (git log + açık işler)
4. Bugünün en fazla 3 hedefini öner ve onay bekle

---

## 10. Güncel Notlar (HACKATHON.md canlı sürümünden, 2 Kasım 2026)

- **NEAR Intents'in testnet'i yok (Q-007).** Intents/1Click mainnet'te, küçük tutar ve `dry: true` quote ile test edilir. Bu proje Intents'e bağlı değil; her şey testnet'te.
- Kod penceresi 19 Ekim 2026'dan itibaren sayılır (Q-001).
- Teslim API'sinde `website` alanı spam tuzağı: asla gönderilmez.
- Araçlar: Rust / cargo-near / near-cli-rs **WSL Ubuntu-22.04** içinde (Windows'tan GitHub release dosyalarına erişilemiyor). Testnet anahtarları WSL `~/.near-credentials/testnet/` ve `.env` içinde.
- Testnet hesapları: `taskin-hack.testnet` (sahip), `guard.` (kontrat), `agent.`, `shop.` (normal alıcı), `refund-desk.` (saldırı demosu için kötü alıcı).
