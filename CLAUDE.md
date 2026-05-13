# CLAUDE.md

> **Bu dosya repo root'unda bulunur ve her Claude Code oturumunda otomatik okunur.**
> Buradaki kurallar tüm task'lar için bağlayıcıdır. Bir conflict olursa bu dosya kazanır.

---

## 1. ZORUNLU BOOTSTRAP — Her şeyden önce yapılacak

**Yeni bir Claude Code oturumu başlattığında, herhangi bir kod yazmadan ÖNCE şu adımları sırayla yap:**

### 1.1 Circle Skills yüklü mü kontrol et

```bash
ls ~/.claude/plugins/marketplaces/circle/ 2>/dev/null || echo "MISSING"
```

Eğer `MISSING` çıkarsa, kullanıcıdan Claude Code içinde şu komutları çalıştırmasını iste:

```
/plugin marketplace add circlefin/skills
/plugin install circle-skills@circle
```

### 1.2 Circle MCP server bağlı mı kontrol et

`/mcp` komutuyla bağlı server'ları gör. `circle` yoksa kullanıcıya şunu çalıştırmasını söyle:

```
claude mcp add --transport http circle https://api.circle.com/v1/codegen/mcp --scope user
```

### 1.3 Skill'leri planlamadan önce oku

**ZORUNLU OKUMA SIRASI** (task'a başlamadan önce):

| Task türü | Önce oku |
|---|---|
| CCTP / bridge / cross-chain | `bridge-stablecoin` skill |
| Arc'a deploy veya Arc-spesifik | `use-arc` skill |
| Wallet oluşturma/yönetimi | `use-circle-wallets` + `use-developer-controlled-wallets` |
| Smart contract deploy | `use-smart-contract-platform` skill |
| Nanopayments / mikroödeme | `use-gateway` skill |
| Routing/swap engine | App Kit docs (`docs.arc.network/app-kit`) |

**Kural:** Skill'i okumadan o alanda kod yazma. Skill'ler architecture decision'ları, common mistakes ve doğru pattern'ları içeriyor.

### 1.4 Live data için MCP'yi kullan

Aşağıdaki bilgiler **eskimiş olabilir** — contract addresses, SDK signatures, chain IDs, CCTP domain IDs, fee yapıları. Bunlara ihtiyaç olduğunda **Circle MCP server'a sor**, hardcoded değer kullanma.

---

## 2. PROJE ÖZETİ

**Ürün:** Cross-Market Execution Agent. Kullanıcı doğal dilde niyet yazar ("100 USDC ile en iyi ETH al"). Ajan:

1. LLM ile niyeti structured action'a çevirir
2. Birden fazla zincirde fiyat, gas, CCTP fee'sini paralel sorgular
3. Optimal rotayı seçer (kaynak zincirde swap mı, başka zincire bridge+swap mi)
4. Kullanıcıdan onay alır (dry-run preview)
5. CCTP V2 Hooks ile atomik olarak yürütür (mint + swap tek tx-de)

**Yarışma:** Agora Agent Hackathon (Canteen + Circle, 2 hafta, $50K).
**Kategori:** Cross-Market Execution Systems.
**Pitch:** "4 zincir, 1 prompt, 1 onay, atomik settlement."

### Neden bu fikir kazanır
- **CCTP V2 Hooks** özelliği ürünün merkezinde — sponsor'ın yeni özelliği
- **Arc**'ı sadece "destekliyoruz" demiyoruz, USDC-as-gas avantajını agent için kullanıyoruz (ajanın gas token'ı için ayrı bakiye yönetmesine gerek yok)
- **App Kit**'in üstüne intelligent routing katmanı koyuyoruz — sıfırdan bridge kodlamıyoruz, mevcut altyapıyı zekice kullanıyoruz
- Opsiyonel: **ERC-8004** agent identity ile ajanın on-chain reputation'ı olur

---

## 3. TEKNOLOJİ STACK — DEĞİŞTİRİLEMEZ

| Katman | Seçim | Neden |
|---|---|---|
| Monorepo | Turborepo + pnpm | Hızlı build, paralel task |
| Smart contracts | Foundry (Solidity 0.8.24+) | Test ve fork desteği |
| Backend | Hono (Node 20+, TypeScript strict) | Hızlı, edge-ready |
| Frontend | Next.js 15 (App Router) + Tailwind + shadcn/ui | Hızlı geliştirme, modern UX |
| LLM | Anthropic Claude API (`claude-sonnet-4-6`) | Tool use + structured output |
| Wallet | Circle Programmable Wallets (developer-controlled) | UX puanı, sponsor entegrasyonu |
| Cross-chain | **CCTP V2** (Bridge Kit SDK) + Arc App Kit | V1 KULLANMA — phase-out 31 Temmuz 2026 |
| DEX aggregation | 0x Swap API (her EVM zinciri için) | Tek API, çoklu zincir |
| Validation | zod | Runtime schema |
| Linting | biome | tek tool, hızlı |
| Hosting | Vercel (web) + Railway (api) | Hackathon için yeterli |

### Desteklenen zincirler (testnet)

**Circle MCP'ye sorarak güncel domain ID'leri ve contract address'leri al. Aşağıdaki bilgiler değişebilir, son söz MCP'ye ait.**

| Zincir | Notlar |
|---|---|
| Ethereum Sepolia | Ana referans zincir |
| Avalanche Fuji | Hızlı, ucuz, test için ideal |
| Base Sepolia | L2, demo'da CCTP Fast'ı gösterir |
| **Arc Testnet** | USDC-as-gas, sub-second finality, agentic economy primitives |

Faucet: https://faucet.circle.com
Arc explorer: https://testnet.arcscan.app

---

## 4. MONOREPO YAPISI

```
agora-agent/
├── apps/
│   ├── web/              # Next.js 15 frontend
│   └── api/              # Hono backend
├── packages/
│   ├── agent/            # LLM intent parser + routing engine
│   ├── chains/           # Chain configs, RPC clients, types
│   ├── contracts/        # Foundry project: Hook contract + interfaces
│   ├── circle/           # Circle SDK wrappers (Wallets, CCTP, App Kit)
│   ├── pricing/          # 0x/DEX aggregator wrappers
│   └── types/            # Ortak TS types (Intent, Route, ExecutionResult)
├── docs/
│   ├── architecture.md   # Mimari kararlar
│   ├── demo-script.md    # Demo senaryoları
│   └── decisions/        # ADR (Architecture Decision Records)
├── .env.example
├── CLAUDE.md             # bu dosya
├── README.md
├── turbo.json
├── package.json
└── pnpm-workspace.yaml
```

### Paket dependency kuralları
- `apps/web` → `packages/agent`, `packages/types`, `packages/chains`, `packages/circle`
- `apps/api` → `packages/agent`, `packages/types`, `packages/chains`, `packages/circle`, `packages/pricing`
- `packages/agent` → `packages/types`, `packages/chains`, `packages/pricing`
- `packages/*` aralarında dairesel bağımlılık YOK

---

## 5. KOD STANDARDI

### TypeScript
- `strict: true`, `noUncheckedIndexedAccess: true`
- `any` yasak. `unknown` + narrowing kullan.
- Public API'ler için zod schema. Tipler schema'dan `z.infer<>` ile türetilir.
- Async fonksiyonlarda `Result<T, E>` pattern'i kullan (neverthrow). Try/catch sadece dış sınırlarda.

### Solidity
- Foundry. `forge fmt` ve `forge test` CI'da zorunlu.
- NatSpec yorumları her external/public fonksiyonda.
- Slither static analysis CI'da.
- Reentrancy guard her external state-changing fonksiyonda.
- Custom errors (revert string yok).

### Frontend
- Server components default. Client component sadece interaktivite gerekenlerde.
- shadcn/ui component'larını ezme — varyant ekle.
- Renkler `tailwind.config`'te token olarak tanımlanır, hex hardcode YASAK.

### Naming
- Files: `kebab-case.ts`
- Components: `PascalCase`
- Functions/vars: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Types/Interfaces: `PascalCase`, prefix YOK (Interface'lere `I` koyma)

---

## 6. GÜVENLİK KURALLARI — İHLAL EDİLEMEZ

1. **Hiçbir private key, API key, mnemonic repo'ya commit edilmez.** `.env.local` gitignore'da.
2. **User funds'a dokunan kod review olmadan main'e merge edilmez.** En az 1 kişi onaylamalı.
3. **Slippage protection zorunlu.** Her execution path'inde maxSlippage parametresi olmalı, aşılırsa revert.
4. **Idempotency:** Aynı intent ID iki kez gelirse ikinci request reddedilir.
5. **Hook contract'larda reentrancy guard zorunlu.**
6. **Dry-run modu default'tur.** Kullanıcı explicit onay vermeden gerçek tx atılmaz.
7. **Testnet ve mainnet config'leri ayrı dosyalarda.** Aynı kod path'inde karışmaz.
8. **CCTP attestation polling timeout'u var** (default 300sn). Sonsuz beklemez.
9. **Rate limiting:** Aynı kullanıcıdan 10sn'de en fazla 3 execution request.

---

## 7. TASK YÖNETİMİ — Claude Code'un Yapması Gerekenler

### Yeni bir task'a başlarken
1. **Plan modunu kullan** (`/plan`). Önce task'ı parçalara böl.
2. İlgili skill'leri oku (bkz. §1.3).
3. Etkilenecek dosyaları listele.
4. Test stratejisini söyle (unit, integration, e2e).
5. Kullanıcıdan onay al.
6. Sonra kod yaz.

### Kod yazarken
- **Küçük, atomik commit'ler.** Bir commit bir mantıksal değişiklik.
- **Conventional commits** format: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.
- Her PR ≤ 400 satır değişiklik. Daha büyükse böl.

### Test
- Her yeni fonksiyon için minimum 1 happy path testi.
- Para hareketi içeren her fonksiyon için minimum 1 failure path testi.
- Smart contract'lar için fuzz test (Foundry `invariant` veya `fuzz`).
- Integration testleri için MSW (frontend) ve nock (backend) ile network mock.

### Dokümantasyon
- Mimari karar verirken `docs/decisions/NNNN-title.md` formatında ADR yaz.
- Her public API'nin JSDoc/NatSpec'i olmalı.
- README'de "how to run locally" adımları daima güncel.

---

## 8. ENV DEĞİŞKENLERİ

`.env.example`:
```bash
# Anthropic
ANTHROPIC_API_KEY=

# Circle
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
CIRCLE_WALLET_SET_ID=

# 0x
ZEROX_API_KEY=

# RPC (testnet)
ETH_SEPOLIA_RPC_URL=
AVAX_FUJI_RPC_URL=
BASE_SEPOLIA_RPC_URL=
ARC_TESTNET_RPC_URL=https://rpc.arc.network/testnet

# Deployment
PRIVATE_KEY_DEPLOYER=   # SADECE testnet
ETHERSCAN_API_KEY=

# App
NEXT_PUBLIC_API_URL=http://localhost:3001
NODE_ENV=development
```

Kural: yeni env değişkeni eklerken `.env.example`'i güncelle ve `packages/config`'de zod ile validate et. Uygulama yanlış env ile başlamamalı — fail-fast.

---

## 9. SIK YAPILAN HATALARI ÖNLE

**CCTP ile ilgili:**
- ❌ V1 contract'larını kullanmak. ✅ V2 canonical.
- ❌ Domain ID'leri ile chain ID'leri karıştırmak. ✅ Domain ID Circle'a özgü, hardcoded değil — MCP'den al.
- ❌ Attestation'ı tek seferde beklemek. ✅ Polling + timeout + retry.
- ❌ Fast Transfer fee'sini hesaba katmamak. ✅ Routing engine'de toplam maliyete dahil et.

**Arc ile ilgili:**
- ❌ Gas için ETH bulundurmaya çalışmak. ✅ Arc'ta gas USDC ile ödenir.
- ❌ Multi-block confirmation beklemek. ✅ Sub-second deterministic finality — tek block yeter.
- ❌ Mainnet'e deploy etmek. ✅ Arc testnet only — mainnet henüz yok.

**Wallet ile ilgili:**
- ❌ Kullanıcının seed phrase'ini frontend'e taşımak. ✅ Developer-controlled wallets backend'de yaşar.
- ❌ Entity Secret'i kod içine gömmek. ✅ Env değişkeni, Circle dashboard'dan rotate edilir.

**LLM ile ilgili:**
- ❌ LLM'in serbest text dönmesine güvenmek. ✅ Tool use ile structured output.
- ❌ Belirsiz niyetlerde tahmin yürütmek. ✅ Clarifying question sor (örn. "ETH derken Ethereum mainnet ETH mi, Base'deki WETH mi?").

**Genel:**
- ❌ USDC'yi 18 decimal varsaymak. ✅ USDC 6 decimal — `parseUnits(amount, 6)`.
- ❌ Demo gününde testnet faucet'lerin dolu olduğunu varsaymak. ✅ Her sabah bakiyeleri kontrol et.

---

## 10. MİLESTONE'LAR

Her milestone ayrı bir prompt dosyasında detaylı tanımlı (`docs/milestones/`). Sırayla yapılır, önceki tamamlanmadan sonrakine geçilmez.

| # | Milestone | Süre | Branch |
|---|---|---|---|
| M0 | Monorepo + tooling + CI | Gün 1 | `chore/m0-setup` |
| M1 | Circle Wallets + first CCTP transfer (Sepolia ↔ Base) | Gün 2-3 | `feat/m1-cctp-basic` |
| M2 | Pricing + gas + routing engine v1 (2 zincir) | Gün 4-5 | `feat/m2-routing` |
| M3 | LLM intent parser + frontend chat UX | Gün 6-7 | `feat/m3-agent-ui` |
| M4 | Arc + Avalanche genişletme (4 zincir) | Gün 8 | `feat/m4-multichain` |
| M5 | CCTP V2 Hooks ile atomic execution | Gün 9 | `feat/m5-hooks` |
| M6 | Güvenlik, error handling, edge cases | Gün 10 | `chore/m6-hardening` |
| M7 | Differentiation feature (Telegram bot veya limit order) | Gün 11 | `feat/m7-bonus` |
| M8 | Polish + demo prep | Gün 12-13 | `chore/m8-polish` |
| M9 | Submission + buffer | Gün 14 | `release/submit` |

Her milestone için ayrı prompt dosyası `prompts/M{N}-{name}.md` altında bulunur.

---

## 11. CLAUDE CODE'A ÖZEL DAVRANIŞ KURALLARI

### Yapmaman gereken
- **Hiçbir milestone'u atlama.** M2 bitmeden M3'e başlama. Bağımlılık var.
- **Skill'leri görmezden gelme.** Bir alanda kod yazmadan önce ilgili skill'i oku.
- **Production-grade demediğim şeylere zaman harcama.** "Beautiful animations" hackathon scope'unda değil — çalışan tx daha değerli.
- **Soru sorulmadan tahmin yürütme.** Ambiguity varsa kullanıcıya sor.
- **Mevcut çalışan kodu refactor etme** kullanıcı istemediği sürece. "Ben şuna bakarken bunu da düzenliyim" YOK.

### Yapman gereken
- **Şüphe varsa Circle MCP'ye sor.** Contract address, SDK signature, fee — hepsi live data.
- **Hata mesajlarını ciddiye al.** "muhtemelen network problemi" diyerek geçiştirme. Stack trace'i oku, root cause bul.
- **Test yaz.** Para hareketi olan kodda test yoksa o kod yoktur.
- **Türkçe veya İngilizce konuşmaya çekinme** — kullanıcı hangisini yazıyorsa o.

---

## 12. DEMO HEDEFİ

Hackathon submission'da göstereceğimiz 3 senaryo:

1. **Basit single-chain:** "Base Sepolia'da 100 USDC'yi ETH'e çevir" — tek zincir baseline
2. **Cross-chain optimal:** "Ethereum Sepolia'da USDC'm var, en iyi ETH fiyatı için Base'e gönder ve oradan ETH al" — CCTP V2 Fast + Hook ile atomik
3. **Multi-chain optimal:** "1000 USDC ile en iyi ETH pozisyonu" — ajan 4 zinciri karşılaştırır, gerekçesini açıklar, kullanıcı onaylar, ajan yürütür

Her senaryo end-to-end çalışmalı, her aşama UI'da görsel olarak takip edilebilmeli, ve testnet tx hash'leri block explorer'da görüntülenebilmeli.

---

## 13. KULLANILAN DOKÜMANTASYON KAYNAKLARI

Bunlar referans olarak okutulan kaynaklar. Bir konuda emin değilsen önce buraya bak:

- **Circle Skills repo:** https://github.com/circlefin/skills
- **Circle Developer Docs (LLM index):** https://developers.circle.com/llms.txt
- **Circle MCP Server:** https://api.circle.com/v1/codegen/mcp
- **Arc Docs (LLM index):** https://docs.arc.network/llms.txt
- **Arc Network:** https://www.arc.network/
- **Arc Litepaper:** https://www.arc.network/litepaper
- **Arc MCP Server:** https://docs.arc.network/ai/mcp
- **Arc Testnet Explorer API:** https://testnet.arcscan.app/api-docs
- **USDC Contract Addresses:** https://developers.circle.com/stablecoins/usdc-contract-addresses
- **CCTP Supported Chains:** https://developers.circle.com/cctp/concepts/supported-chains-and-domains
- **0x Swap API:** https://0x.org/docs/api

---

**Son söz:** Bu doküman canlıdır. Mimari karar değiştiğinde buraya yansıt. Yeni bir kural eklediğinde "neden" kısmını da yaz. Gelecekteki Claude (ve insan) bunu okuyacak.
