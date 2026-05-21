# CLAUDE.md — じゃんけんサバイバー 引き継ぎドキュメント

## プロジェクト概要

HTML5 Canvas製のじゃんけんサバイバルゲーム。ESModules構成（バンドラなし）。
開発サーバ：`npx serve` → `http://localhost:3000`
リポジトリ：https://github.com/sakazeruga/JankenSurvivor  
push 時は `git push --force origin main`（リモートが古い可能性があるため）

---

## ファイル構成

```
index.html          ← Canvas + CSS（dvh対応済み）
src/
  main.js           ← ゲームループ・BGM切り替え
  game.js           ← GameManager（全ロジック）
  renderer.js       ← Renderer（全描画）
  entities.js       ← Enemy / Bullet / Laser / Particle
  stage.js          ← ステージ・Wave生成（シードRNG）
  constants.js      ← 全定数・スキル定義
  core.js           ← judge() / chainExplosion()
  input.js          ← タッチ・クリック入力
  audio.js          ← BGM/SFX管理
assets/audio/       ← TitleBGM / StageBGM / BossBGM / GrandBossBGM
assets/wav/         ← 各SE
```

---

## 仮想解像度

- `CANVAS_W = 390`, `CANVAS_H = 760`（Pixel8a縦向き相当）
- Canvas は CSS でウィンドウに fit（`_fitToWindow()`）
- `KILL_LINE_Y = 620`（ボタンエリア上端）

---

## ゲームフロー

```
TITLE → DIFFICULTY_SELECT → PLAYING → WAVE_RESULT（スキル選択）→ PLAYING ...
Wave 1・2：通常ボス（👑）
Wave 3   ：大ボス（👑👑）
3Wave クリア → 次ステージ（スコア+1000）
```

`GameState`：`TITLE / DIFFICULTY_SELECT / PLAYING / WAVE_RESULT / GAME_OVER`

---

## スキルシステム

### ストレージキー規則

```js
// ROCK/SCISSORS/PAPER 列の共通・レアスキル
key = `${ATTR}_${skillId}`   // 例: "ROCK_com_bullets", "SCISSORS_rare_split"

// UTIL 列
key = skillId                 // 例: "util_bomb", "rare_shield", "rare_power"
```

`game.js` の `skillKey(skill)` 関数が変換を担う。

### コスト計算（列ごとに2倍）

```js
const n    = this.columnPurchases[cat] || 0;   // cat = ROCK/SCISSORS/PAPER/UTIL
const cost = skill.baseCost * Math.pow(2, n);
this.columnPurchases[cat] = n + 1;
```

### スキル一覧（現在値）

| 列 | スキルID | 効果 | baseCost |
|---|---|---|---|
| ROCK | com_bullets | 弾数+1 | 300 |
| ROCK | com_speed | 弾速+40%/Lv | 300 |
| ROCK | com_power | 攻撃力+60%/Lv | 300 |
| ROCK | rare_pierce | 20%で貫通弾。**弾速Lvが攻撃力にも+60%/Lv加算** | 600 |
| SCISSORS | com_bullets | 弾数+1（分裂弾も2×Lv本に増加） | 300 |
| SCISSORS | com_speed | 弾速+40%/Lv | 300 |
| SCISSORS | com_power | 攻撃力+60%/Lv | 300 |
| SCISSORS | rare_split | 20%で分裂弾。**弾数Lvで発射数=2×Lv本** | 600 |
| PAPER | com_bullets | 弾数+1 | 300 |
| PAPER | com_speed | 弾速+40%/Lv | 300 |
| PAPER | com_power | 攻撃力+60%/Lv（**レーザーには+120%/Lv**） | 300 |
| PAPER | rare_laser | 20%でレーザー。攻撃力強化が2倍適用 | 600 |
| UTIL | util_bomb | ボム回数+1 | 400 |
| UTIL | util_score | スコア倍率×1.1 | 400 |
| UTIL | rare_shield | 守護盾（後述） | 400 |
| UTIL | rare_power | 全攻撃力+40%/Lv | 600 |

レア枠出現率：25%（UTIL含む全列）

---

## 攻撃力計算

```js
// 通常弾・貫通弾ベース
_getAttackPower(attribute) {
  const comPower  = this.skills[`${attribute}_com_power`] || 0;
  const rarePower = this.skills['rare_power'] || 0;
  return (1 + 0.6 * comPower) * (1 + 0.4 * rarePower);
}

// 貫通弾（ROCK）— 弾速Lvも攻撃力に加算
const speedLv   = this.skills['ROCK_com_speed'] || 0;
const piercePow = power * (1 + 0.6 * speedLv);

// レーザー（PAPER）— com_power倍率が2倍
const laserPower = (1 + 1.2 * comPower) * (1 + 0.4 * rarePower);
damage = Math.round(laserPower * 0.5);

// 弾速
const speedMult = 1 + 0.4 * (this.skills[`${attribute}_com_speed`] || 0);
```

---

## 守護盾（rare_shield）

- **一般枠**（UTIL列で毎回出現候補）、baseCost=400
- `shieldCharges` = 購入回数（= Lv）。消費しない。
- 被弾時（ボス以外）：
  1. `shieldInvincTimer > 0`（無敵中）→ 無料ブロック
  2. `shieldCharges > 0 && shieldCTTimer <= 0`（準備完了）→ 無敵発動
  3. それ以外 → ペナルティ適用
- 無敵時間：`0.8 + 0.2 * shieldCharges`秒（Lv1=1.0s, Lv2=1.2s...）
- CT：無敵終了後 5.0秒
- 発動中：画面が青くパルス（`rgba(30,120,255, 0.12~0.18)`）
- HUD：`🛡 Lv.N ▶1.0s`（水色）/ `CT4.8s`（グレー）/ `待機中`（青）

---

## 敵・エネミータイプ

| 種類 | HP倍率 | 通過ペナルティ倍率 | radius |
|---|---|---|---|
| NORMAL | ×1 | ×1 | 24 |
| MEDIUM | ×2 | ×3 | 32（24×1.35） |
| LARGE | ×5 | ×5 | 42（24×1.75） |
| 通常ボス | 20×2^stage | ×3 | 38 |
| 大ボス | 60×2^stage | ×3 | 52 |

ペナルティ計算：
```js
const typeMult = enemy.isBoss ? 3
  : enemy.enemyType === ENEMY_TYPE.LARGE  ? 5
  : enemy.enemyType === ENEMY_TYPE.MEDIUM ? 3 : 1;
const penalty = Math.round(BASE_HIT_PENALTY * stageMult * diffMult * typeMult);
// stageMult = stageIndex/3+1, BASE_HIT_PENALTY = 500
```

---

## ボス・バリアシステム

両ボスとも `bossShieldPhase`（0/1/2）と `bossShieldTimer` を持つ。

```js
// entities.js Enemy コンストラクタ（ボス時）
this.bossShieldPhase = 1;    // 登場時からシールド発動
this.bossShieldTimer = null; // 初回update時に初期化
```

フェーズ切り替え間隔：`3.5 + stageIndex * 0.4` 秒

| フェーズ | 通常ボス | 大ボス | 効果 |
|---|---|---|---|
| 0 | 無防備 | 無防備 | ダメージ通る |
| 1 | 🛡 GUARD | 🛡 GUARD | 全ダメージ無効（`_applyDamage` でブロック） |
| 2 | — | ⊘ BARRIER | あいこ無効（`_handleJudgment` の DRAW 分岐でブロック） |

大ボスは 0→1→2→0 でサイクル（各1/3ずつ）  
通常ボスは 0↔1 でトグル

描画：
- GUARD：シアン光輪 + `GUARD` テキスト（水色）
- BARRIER：白点線輪 + `BARRIER` テキスト（薄紫）

---

## 大ボスのスキル召喚

`skillTimer`（`GRAND_BOSS_SKILL_PERIOD = 3.5`秒）ごとに A→B→C→A...

| フェーズ | 内容 | 出現位置 |
|---|---|---|
| A | 通常雑魚 15〜20体（1属性） | 上半分（boss.y+60 ～ CANVAS_H/2） |
| B | 中型雑魚 7〜8体（混合） | 上半分（同上） |
| C | 大型あいこ無効 2〜3体 | 上半分（同上） |

---

## 通常ボスのミニオン召喚

`summonTimer`（`BOSS_SUMMON_PERIOD = 1.17`秒）ごとにランダム1体スポーン。

---

## BGM管理（main.js）

```
TITLE / DIFFICULTY_SELECT → TitleBGM
WAVE_RESULT（スキル選択）→ TitleBGM
PLAYING + 大ボス生存 → GrandBossBGM
PLAYING + 通常ボス生存 → BossBGM
PLAYING（雑魚のみ）→ StageBGM
GAME_OVER → stopBgm()
```

---

## 描画の主要ポイント（renderer.js）

- `_drawActiveSkillPanel(gm)` — 右上フロートパネルにスキルLv表示
- `_drawSkillShop(gm)` — WAVE_RESULT 画面（コスト = baseCost × 2^columnPurchases[cat]）
- スキルキー解析：`skillKey(skill)` / `skillKeyMeta(key)` で attr+id → 表示ラベル変換
- 貫通弾（ROCK）：赤、先端強調
- 分裂弾（SCISSORS）：オレンジ `#FF7700` + 側面サテライト点
- レーザー（PAPER）：青い光線

---

## モバイル表示（index.html）

`100dvh` + `-webkit-fill-available` + JS で `document.body.style.height = window.innerHeight + 'px'` を設定。Chrome/Slack のアドレスバー問題を解消済み。

---

## よく使うコマンド

```bash
# 開発サーバ起動
npx serve

# push（force が必要）
git push --force origin main

# 状態確認
git log --oneline -10
```
