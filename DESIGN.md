# 設計書：じゃんけんサバイバー（JMP）

**プロジェクト名:** じゃんけんサバイバー（JMP: Janken Match Puzzle）  
**バージョン:** 0.1（初版）  
**作成日:** 2026-05-18  
**ステータス:** ドラフト

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [ゲームシステム設計](#2-ゲームシステム設計)
3. [アーキテクチャ設計](#3-アーキテクチャ設計)
4. [クラス設計](#4-クラス設計)
5. [データ設計](#5-データ設計)
6. [ステージ自動生成アルゴリズム](#6-ステージ自動生成アルゴリズム)
7. [UI/UX設計](#7-uiux設計)
8. [マネタイズ設計](#8-マネタイズ設計)
9. [開発フェーズ計画](#9-開発フェーズ計画)

---

## 1. プロジェクト概要

### 1.1 コンセプト

| 項目 | 内容 |
|------|------|
| ジャンル | ハイパーカジュアル2.0 / ローグライト |
| ターゲット | グローバル（日本・東南アジア・北米） |
| プラットフォーム | iOS / Android |
| マネタイズ | IAA（広告）主軸 + IAP（パス課金）補完 |
| 開発コンセプト | 非人力・自動生成型。手動アセット制作ゼロ、手動レベルデザインゼロ |

### 1.2 3大設計原則

```
1. Easy to Learn    : じゃんけんの属性相性だけで1秒でルール理解
2. Hard to Master   : ローグライト・スキルビルドによる深みと戦略性
3. 低コスト自動生成  : ステージ・バナー・広告タイミングをすべてコードと AI が生成
```

### 1.3 勝因分析（市場適合性）

```
市場トレンド（2026年4月時点）
  └── ダウンロード数は拡大、課金 ARPU は成熟 → IAA+少額 IAP で広く浅く回収
  └── ドラクエスマグロ（ランダムスキル×殲滅）のヒット → ローグライト要素が刺さる
  └── Arrows / ブロックブラスト（フラットジオメトリ）のヒット → 低負荷 UI が刺さる

JMP の刺さりポイント
  ├── じゃんけん = 入口の低さで最大規模のユーザー層をカバー
  ├── 殲滅連鎖 + スキルビルド = リテンション・ループの深み
  └── 幾何学図形のみ = グラフィック制作費ゼロ・グローバル展開で文化摩擦ゼロ
```

---

## 2. ゲームシステム設計

### 2.1 属性システム

#### 2.1.1 3属性の定義

| 属性 | 記号 | カラー | 勝ち相手 | 負け相手 |
|------|------|--------|----------|----------|
| グー（Rock）  | ✊ | 赤 `#E74C3C` | チョキ | パー |
| チョキ（Scissors）| ✌ | 緑 `#2ECC71` | パー | グー |
| パー（Paper） | ✋ | 青 `#3498DB` | グー | チョキ |

#### 2.1.2 衝突判定ロジック

```
enum Attribute { ROCK, SCISSORS, PAPER }

function judge(attacker: Attribute, defender: Attribute): Result
  if attacker == defender  → DRAW    （相殺、双方消滅）
  if beats(attacker, defender) → WIN （敵消滅 + 連鎖判定）
  else                     → LOSE   （プレイヤーHP減少）

function beats(a: Attribute, b: Attribute): bool
  return (a == ROCK     && b == SCISSORS)
      || (a == SCISSORS && b == PAPER)
      || (a == PAPER    && b == ROCK)
```

### 2.2 コアゲームループ

```
[ゲーム開始]
    │
    ▼
[ウェーブ生成] ← ステージ自動生成アルゴリズム（§6）
    │
    ▼
[エネミー降下] ── 速度 v = f(ステージ数 x)
    │
    ▼
[プレイヤー入力] ─ タップ or スワイプ（ROCK / SCISSORS / PAPER レーン選択）
    │
    ▼
[弾丸発射] → [衝突判定]
    │              │
    │              ├── WIN  → 連鎖爆発判定 → コンボカウンタ +1
    │              ├── DRAW → 相殺消滅
    │              └── LOSE → HP -1
    │
    ▼
[コンボ 10 連勝?]
    ├── YES → [ULTIMATE ボタン出現] → 発動で全消し（一定時間）
    └── NO  → 継続
    │
    ▼
[ウェーブクリア?]
    ├── YES → [スキル選択画面（3択）] → 次ウェーブ
    └── NO  → [HP == 0 ?]
                  ├── YES → [ゲームオーバー / 広告 or コンティニュー]
                  └── NO  → 継続
```

### 2.3 連鎖爆発システム（殲滅の爽快感）

```
WIN 判定時:
  1. 撃破エネミーの周囲 radius R 内にいる同属性エネミーを検索
  2. 発見数 n ≥ 1 ならば CHAIN_EXPLOSION 発動
  3. 連鎖したエネミーからさらに同属性を再帰探索（最大深度 = CHAIN_DEPTH スキル値）
  4. スコア = 基底スコア × (1 + 0.5 × チェーン数)
```

### 2.4 バーストモード（ULTIMATE）

| 条件 | 効果 | 持続時間 |
|------|------|----------|
| コンボ 10 連勝 | 画面中央に ULTIMATE ボタン出現 | ボタン表示は 5 秒 |
| ボタンタップ | 全属性 WIN、自動照準で全エネミー消去 | 8 秒間（スキルで延長可） |
| ULTIMATE 中ミス | ミスなし（全勝扱い）| ─ |

### 2.5 スキルシステム（ローグライト要素）

#### 2.5.1 スキルカテゴリ

```
カテゴリ A: 弾丸強化
  ├── ROCK_WIDE      : グー弾の爆発半径 +50%
  ├── SCISSORS_RAPID : チョキ弾の連射速度 +100%
  ├── PAPER_SPREAD   : パー弾が 3-WAY 拡散
  └── ALL_PIERCE     : すべての弾が貫通（最大 3 体）

カテゴリ B: チェーン強化
  ├── CHAIN_RANGE    : 連鎖探索半径 +30%
  ├── CHAIN_DEPTH    : 連鎖再帰深度 +1
  └── CHAIN_SCORE    : 連鎖スコア倍率 +25%

カテゴリ C: バースト強化
  ├── BURST_EXTEND   : ULTIMATE 持続時間 +4 秒
  ├── BURST_GAUGE    : ULTIMATE 発動必要コンボ数 -2
  └── BURST_RESET    : ULTIMATE 終了後コンボカウンタを 5 に設定

カテゴリ D: 生存強化
  ├── HP_REGEN       : ウェーブクリア時 HP +1（最大 5）
  ├── SHIELD         : 初回 LOSE を無効化（1 回限り）
  └── DRAW_GUARD     : DRAW 判定でも HP を消費しない
```

#### 2.5.2 スキル選択ロジック

```
ウェーブクリア時:
  1. スキルプールから重み付きランダムで 3 枚を非重複選択
  2. プレイヤーが 1 枚選択
  3. 選択されたスキルを ActiveSkills リストへ追加
  4. 同一スキルを再取得した場合: レベルアップ（効果値 × 1.5）
```

### 2.6 ゲーミフィケーション

#### 2.6.1 ランクシステム

| ランク | 必要スコア（累計） |
|--------|-----------------|
| ブロンズ III→I | 0 〜 9,999 |
| シルバー III→I | 10,000 〜 29,999 |
| ゴールド III→I | 30,000 〜 79,999 |
| プラチナ III→I | 80,000 〜 199,999 |
| ダイヤ III→I | 200,000 〜 499,999 |
| マスター | 500,000 〜 999,999 |
| グランドマスター | 1,000,000〜（無限） |

シーズン制：30 日ごとにリセット、前シーズン最高ランクに応じたリワードを配布。

#### 2.6.2 デイリーパズルチャレンジ

```
仕様:
  - 毎日 0:00 UTC に新パズルを自動生成して配信
  - フォーマット: 固定盤面 + 限定手数（N 手以内に全消し）
  - 成功報酬: ランクポイント +500、コイン +100
  - 連続ログインボーナス: 7 日連続でプレミアムスキル解放（期間限定）

生成ルール（自動）:
  - シード = 日付のハッシュ → 決定論的乱数で盤面生成
  - 難易度 = 曜日ごとに固定（月〜水: 易、木〜土: 中、日: 難）
```

---

## 3. アーキテクチャ設計

### 3.1 全体構成

```
┌─────────────────────────────────────────────────────┐
│                  JMP Application                    │
│                                                     │
│  ┌───────────┐  ┌───────────┐  ┌─────────────────┐ │
│  │ Game Scene│  │ UI Layer  │  │  Data Layer     │ │
│  │           │  │           │  │                 │ │
│  │ GameLoop  │  │ HUD       │  │ PlayerData      │ │
│  │ EnemyMgr  │  │ SkillMenu │  │ SkillConfig     │ │
│  │ BulletMgr │  │ ResultScr │  │ StageConfig     │ │
│  │ ChainCalc │  │ ShopUI    │  │ LeaderBoard     │ │
│  └─────┬─────┘  └─────┬─────┘  └───────┬─────────┘ │
│        └──────────────┴────────────────┘           │
│                  EventBus (中央バス)                 │
│                                                     │
│  ┌─────────────────┐  ┌───────────────────────────┐ │
│  │ StageGenerator  │  │  LiveOps / AI Engine      │ │
│  │ (純粋関数・DI)  │  │  BannerScheduler          │ │
│  │                 │  │  AdTimingOptimizer        │ │
│  └─────────────────┘  └───────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 3.2 推奨エンジン・ライブラリ

| 用途 | 採用候補 | 理由 |
|------|----------|------|
| ゲームエンジン | **Unity 2022 LTS** / Godot 4 | モバイル最適化・広告SDK対応 |
| 物理・衝突判定 | エンジン内蔵（2D Physics） | 外部依存ゼロ |
| 広告 SDK | AppLovin MAX | Mediation で eCPM 最大化 |
| 分析 | Firebase Analytics | 無料・リアルタイム |
| バックエンド（ランク/デイリー） | Firebase Firestore | サーバーレス・スケール自動 |
| AI LiveOps | カスタム軽量モデル or 外部 API | §8 参照 |

---

## 4. クラス設計

### 4.1 主要クラス一覧

```
GameManager
  + currentStage: int
  + playerHP: int
  + comboCount: int
  + activeSkills: List<Skill>
  + state: GameState {PLAYING, SKILL_SELECT, GAME_OVER}
  + StartWave()
  + OnBulletHit(bullet, enemy)
  + TriggerUltimate()
  + OnWaveCleared()

Enemy
  + attribute: Attribute
  + hp: float
  + speed: float
  + position: Vector2
  + Update(dt)
  + TakeDamage(amount)
  + OnDestroyed()

Bullet
  + attribute: Attribute
  + speed: float
  + pierceCount: int        ← ALL_PIERCE スキルで増加
  + spreadAngle: float      ← PAPER_SPREAD スキルで設定
  + OnHitEnemy(enemy)

ChainCalculator                ← 純粋クラス（副作用なし）
  + Calculate(origin: Enemy, allEnemies: List<Enemy>,
              radius: float, maxDepth: int): List<Enemy>

SkillManager
  + pool: List<SkillDefinition>
  + active: List<Skill>
  + DrawThree(): List<SkillDefinition>
  + Apply(def: SkillDefinition)
  + GetStatModifier(key: string): float

StageGenerator                 ← §6 参照
  + Generate(stageIndex: int, seed: int): StageConfig

PlayerDataRepository           ← ローカル保存 + Firebase 同期
  + Save(data: PlayerData)
  + Load(): PlayerData
  + SyncToCloud()
```

### 4.2 イベントバス（疎結合のため）

```
EventBus イベント一覧:
  EVT_ENEMY_DESTROYED (enemy, isChain)
  EVT_PLAYER_HIT
  EVT_COMBO_UPDATED (count)
  EVT_ULTIMATE_READY
  EVT_WAVE_CLEARED (waveIndex)
  EVT_SKILL_SELECTED (skillDef)
  EVT_GAME_OVER (finalScore)
```

---

## 5. データ設計

### 5.1 SkillDefinition（スキル定義）

```json
{
  "id": "ROCK_WIDE",
  "category": "BULLET",
  "displayName": "グー爆発拡大",
  "description": "グーで倒した時の爆発半径が 50% 拡大",
  "maxLevel": 3,
  "effectKey": "rock_explosion_radius",
  "effectPerLevel": 0.5,
  "weight": 10
}
```

### 5.2 StageConfig（ステージ設定 ─ 自動生成出力）

```json
{
  "stageIndex": 15,
  "waveCount": 5,
  "waves": [
    {
      "waveIndex": 0,
      "enemies": [
        { "attribute": "ROCK",     "count": 8, "speed": 2.5, "hp": 1.0 },
        { "attribute": "SCISSORS", "count": 4, "speed": 2.5, "hp": 1.0 }
      ],
      "spawnInterval": 0.8
    }
  ],
  "bossWave": {
    "attribute": "PAPER",
    "hp": 10,
    "speed": 1.5,
    "abilityFlags": ["SHIELD", "SPLIT_ON_DEATH"]
  }
}
```

### 5.3 PlayerData（プレイヤー保存データ）

```json
{
  "userId": "uuid-v4",
  "seasonScore": 48200,
  "currentRank": "GOLD_I",
  "dailyStreak": 5,
  "lastPlayDate": "2026-05-18",
  "lifetimeStats": {
    "totalGamesPlayed": 312,
    "maxCombo": 47,
    "totalEnemiesDestroyed": 18943
  },
  "purchases": []
}
```

---

## 6. ステージ自動生成アルゴリズム

### 6.1 パラメータ関数

ステージ番号を `x`（0-indexed）とする。

```
// 基本速度：ステージごとに 0.1 ずつ上昇、上限 4.5
enemySpeed(x)     = min(1.0 + 0.10 × x,  4.5)

// ウェーブあたり敵数：序盤は緩やか、後半は急増
enemyCount(x)     = floor(6 + 0.8 × x + 0.02 × x²)

// ウェーブ数：5 ウェーブから始まり最大 12 まで増加
waveCount(x)      = min(5 + floor(x / 10), 12)

// 敵 HP 倍率：10 ステージごとに 0.5 追加
hpMultiplier(x)   = 1.0 + 0.05 × floor(x / 10) × (x / 10)

// スポーン間隔（秒）：速くなるほど難化、下限 0.3 秒
spawnInterval(x)  = max(1.2 - 0.02 × x, 0.3)

// 属性混合複雑度（0.0 = 単一属性, 1.0 = 完全ランダム）
attributeMix(x)   = min(x / 30, 1.0)
```

### 6.2 属性配分ロジック

```
function distributeAttributes(totalCount, mix, rng):
  if mix < 0.2:
    // 単一属性で大群
    dominant = rng.pick([ROCK, SCISSORS, PAPER])
    return [{ dominant: totalCount }]

  else if mix < 0.6:
    // 主属性 70% + 従属性 30%
    dominant = rng.pick([ROCK, SCISSORS, PAPER])
    minor    = rng.pick(remaining)
    return [{ dominant: floor(totalCount × 0.7) },
            { minor:    ceil(totalCount  × 0.3) }]
  else:
    // 3 属性をほぼ均等 + ランダムな偏り
    base = floor(totalCount / 3)
    余り = totalCount - base × 3
    weights = [base + rng.int(0,余り), base, base]  ← シャッフル
    return zip([ROCK, SCISSORS, PAPER], weights)
```

### 6.3 ボスウェーブ生成

```
ボス出現条件: stageIndex % 5 == 4（5 の倍数ステージ）

bossAttribute    = rng.pick([ROCK, SCISSORS, PAPER])
bossHP           = 5 + floor(stageIndex / 5) × 3
bossSpeed        = enemySpeed(stageIndex) × 0.6    ← ボスはゆっくりだが固い
abilityFlags     = []

if stageIndex ≥ 10: abilityFlags.push("SHIELD")        // 1 発無効
if stageIndex ≥ 20: abilityFlags.push("SPLIT_ON_DEATH") // 撃破時に 2 体に分裂
if stageIndex ≥ 35: abilityFlags.push("AURA")          // 周囲の敵を強化
```

### 6.4 デイリーパズル生成

```
seed    = sha256(date_string).slice(0, 8)  → 32-bit uint
rng     = SeededRandom(seed)
grid    = 4×4 マス
tiles   = generate_solvable_grid(rng, difficulty(weekday))

solvable 保証:
  1. ランダムグリッドを生成
  2. 解探索（BFS/DFS、最大深度 = 手数制限）
  3. 解なし → seed+1 で再試行（最大 10 回）
  4. 解ありを確認してから配信
```

---

## 7. UI/UX 設計

### 7.1 ビジュアルルール

```
カラーパレット（3 属性 + ニュートラル）:
  ROCK      #E74C3C  （赤系）
  SCISSORS  #2ECC71  （緑系）
  PAPER     #3498DB  （青系）
  BG        #1A1A2E  （ダークネイビー）
  UI        #FFFFFF / #AAAAAA

図形ルール:
  エネミー: 直径 48dp の円。内部に属性アイコン（SVG）
  弾丸:     直径 16dp の塗りつぶし円
  爆発:     リングが外側へ拡大するパーティクル（頂点シェーダのみ）
  背景:     単色グラデーション。テクスチャ不使用
  フォント: システムフォントのみ（端末依存、ダウンロードフォント不使用）
```

### 7.2 画面遷移

```
[起動画面]
    │
    ├── ログイン後 ──→ [ホーム]
    │                    │
    │     ┌──────────────┼─────────────┐
    │     ▼              ▼             ▼
    │  [ゲーム開始]  [ランキング]  [デイリー]
    │     │
    │     ▼
    │  [ゲームプレイ中]
    │     │
    │     ├── ウェーブクリア ──→ [スキル選択（3 択）] → [ゲームプレイ中]
    │     │
    │     ├── ULTIMATE 発動 ──→ [バーストエフェクト] → [ゲームプレイ中]
    │     │
    │     └── HP 0 ──→ [リザルト]
    │                      │
    │                 ├── 広告視聴 ──→ [コンティニュー（HP=1）]
    │                 └── 終了 ──→ [ホーム]
    │
    └── 設定 ──→ [設定画面]
```

### 7.3 ゲームプレイ画面 レイアウト

```
┌────────────────────────────┐
│  WAVE: 3/5    HP: ███░░   │  ← ステータスバー
│  SCORE: 12,400             │
├────────────────────────────┤
│                            │
│   ✊ ✌ ✋  ✊ ✊          │  ← エネミー降下エリア（上から下へ）
│        ✌                   │
│   ✋       ✌ ✊            │
│                            │
│ ─────────────────────────  │  ← 撃墜ライン
│                            │
│  [ COMBO: 7 ]  [ULTIMATE]  │  ← コンボ表示・ULTIMATE ボタン
├────────────────────────────┤
│   [✊]      [✌]      [✋]  │  ← 操作ボタン（3 択）
└────────────────────────────┘
```

---

## 8. マネタイズ設計

### 8.1 収益構造

```
IAA（広告）─ 収益の 70% 目標
  ├── インタースティシャル広告
  │     出現タイミング: ゲームオーバー時（毎回）
  │                    ホーム帰還時（3 回に 1 回）
  ├── リワード広告
  │     コンティニュー（+1 HP）
  │     デイリーパズルのヒント解放
  │     スキル 4 択目の解放（3 択 → 4 択に変換）
  └── バナー広告: リザルト画面下部に常時表示

IAP（課金）─ 収益の 30% 目標
  ├── ウィークリーパス（¥480/週）
  │     広告非表示 + デイリー報酬 2 倍 + 限定スキルスキン
  ├── シーズンパス（¥980/月）
  │     ウィークリーパス全機能 + 専用ランクフレーム + ボーナスコイン
  └── コインパック（¥120 〜 ¥1,200、消耗品）
        用途: コンティニュー購入・スキルリロール
```

### 8.2 AI LiveOps（広告タイミング最適化）

```
入力フィーチャ:
  - プレイセッション時間（分）
  - 直近 5 ゲームの平均スコア
  - 最終ログインからの経過時間
  - デバイス種別・通信環境

出力:
  - 次の広告表示タイミング（次のゲームオーバーか、n ゲーム後か）
  - リワード広告のオファータイミング（プレイヤーが詰まった瞬間を検出）

実装:
  Phase 1（MVP）: ルールベース（しきい値で制御）
  Phase 2:        Firebase ML でオンデバイス推論
  Phase 3:        サーバーサイドパーソナライズ（MAU 100 万超到達後）
```

### 8.3 LTV 最大化フロー

```
新規ユーザー
  Day 0-1: 広告なし or 最小表示 → 離脱率低下・好印象形成
  Day 2-7: デイリーログインボーナスでリテンション強化
  Day 7  : ウィークリーパス初回割引オファー
  Day 14+: シーズンパスへのアップセル
```

---

## 9. 開発フェーズ計画

### 9.1 フェーズ分割

| フェーズ | 期間目安 | 成果物 | KPI |
|---------|----------|--------|-----|
| **P0: プロト** | 〜3 日 | コアループ動作確認（衝突判定・弾丸・連鎖） | ゲームループが 1 周回る |
| **P1: MVP**   | 〜2 週 | ステージ自動生成 + スキルシステム + ランク | ストア審査提出可能 |
| **P2: 収益化** | 〜1 週 | 広告 SDK 組み込み + IAP 実装 | D1 Retention ≥ 40% |
| **P3: LiveOps** | 〜2 週 | デイリーパズル + シーズン制 + AI 広告最適化 | D7 Retention ≥ 20% |
| **P4: グローバル** | 〜1 週 | 多言語対応（英/日/中/韓/タイ）+ ストア最適化 | グローバルリリース |

### 9.2 P0 で実装する最小セット

```
[必須]
  ✓ Attribute enum + judge() 関数
  ✓ Enemy の生成・降下・消滅
  ✓ Bullet の発射・衝突検知
  ✓ ChainCalculator（BFS で連鎖探索）
  ✓ HP 管理・ゲームオーバー判定
  ✓ タップ入力の 3 択 UI

[P0 では不要]
  ✗ スキルシステム（P1）
  ✗ ランク・保存データ（P1）
  ✗ 広告 SDK（P2）
  ✗ サーバー通信（P2〜）
```

### 9.3 品質基準

| 指標 | 目標値 |
|------|--------|
| フレームレート | 60 fps（ミドルレンジ端末以上） |
| アプリサイズ | ≤ 30 MB（OTA） |
| ロード時間 | ≤ 2 秒（コールドスタート） |
| クラッシュ率 | ≤ 0.5%（Firebase Crashlytics） |

---

*設計書 END — 次ステップ: P0 プロトタイプ実装*
