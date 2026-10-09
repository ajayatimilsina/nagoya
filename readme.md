## Reference site feature list

### Found on the live customer page

- Header: 「あじまるや & 中島駅 · ご注文」.
- Horizontally scrollable category tabs: 定食, ナンセット, ナン単品, 鍋・麺, サブメニュー, ご飯, お子様メニュー, ドリンク, 飲み放題ドリンク, ラーメン, デザート, 飲み放題, お品書き, コース料理.
- Menu cards show Japanese item names, yen prices, selectable extras where configured, and per-item − / + controls. Empty sections show 「準備中です。」.
- Party fields: 大人, 子ども, 性別 (All / Men / Women), アレルギー (なし / あり), 会員価格, and a live headcount.
- 「領収書が必要です」 reveals the 「宛名」 input.
- A fixed bottom order dock shows count, total, party size, and 「注文する」.
- The page was inspected at 390 × 844. It uses a sticky brand/category header, stacked menu cards, and large mobile controls. No live order was submitted.

### Assumed or required additions

- The accessible customer page did not expose a separate cart/confirmation screen, real-time status, call-staff action, pickup notice, or table-closed thank-you flow. These are added from the supplied specification.
- `?table=3` still displayed “Table 1” on the live page; this implementation uses the URL table number as requested.
- Out-of-stock styling/order prevention and special notes were not visible in the inspected menu; both are implemented from the supplied specification.

## Project tree

```text
.
├── db/
│   ├── schema.sql
│   └── seed.json
├── public/
│   ├── customer.html
│   ├── customer.js
│   ├── finance.html
│   ├── index.html
│   ├── inventory.html
│   ├── kitchen.html
│   ├── menu.html
│   ├── pos.html
│   ├── staff.js
│   └── styles.css
├── tests/
│   └── database.test.js
├── server.js
├── package.json
├── package-lock.json
└── readme.md
```

## SQLite schema

`db/schema.sql` defines `menu_items`, `orders`, `order_items`, `notices`, `payments`, `inventory_logs`, and `expenses`. `db/seed.json` carries the requested menu IDs 80–98. Order rows preserve customer party/allergy/member fields, receipt request and 宛名, order-level notes, line options, and kitchen statuses. Each order line becomes a separate no-price KDS ticket.

## Setup

Requires Node.js 24 or newer (`node:sqlite` is built in). Run:

```powershell
npm install
$env:STAFF_PIN = "change-this-pin"
$env:PUBLIC_URL = "https://your-ordering-host.example"
npm run dev
```

Customer: `http://localhost:3000/index.html?table=3` (redirects to the customer UI and preserves the table query). Staff: `/kitchen.html`, `/pos.html`, `/menu.html`, `/inventory.html`, and `/finance.html`. The development PIN is `2468` when `STAFF_PIN` is unset; set a strong PIN before network exposure. The POS page generates a per-table QR code using `PUBLIC_URL`.

KDS slips and receipts use thermal print CSS at approximately 80 mm. Enable 自動印刷 in the KDS; Chrome's `--kiosk-printing` flag enables unattended printing where the printer is configured. The first KDS interaction enables browser sound and ja-JP speech. SQLite data is stored in `data/ajimaruy.sqlite`; back it up while the service is stopped. This single-server PIN gate is a small-shop safeguard, not production identity management; use HTTPS and restrict network access.

Run the schema/seed smoke test with `npm test`.

---

Here is a consolidated prompt you can paste into any AI. I merged your original request with your Nepali/Japanese notes and listed my assumptions at the end.

---

## PROMPT

**Act as a Senior Software Architect and Full-Stack Developer (SATAIC).**

Build a **lightweight QR-based restaurant ordering & POS system** for a Japanese-Indian (naan/curry) restaurant. The UI language is **Japanese**, and the code comments are in English.

### Tech Stack
- Frontend: HTML5, Bootstrap 5, Vanilla JS (ES modules)
- Backend/realtime: **Firebase Realtime DB / Firestore** (or Node.js + Express + SQLite + WebSocket; choose one and justify it)
- Printing: Browser `window.print()` with `@media print` CSS for 80mm/58mm thermal paper. Support **direct silent printing** (Chrome `--kiosk-printing` flag) and optionally ESC/POS via a local Node print server.

### Deliverables
1. Modular folder structure
2. Database schema (JSON) with sample data
3. Complete working source code for every page below
4. Setup guide (hosting, QR code generation per table, printer setup)

### Pages

**1. Customer UI** (`index.html?table=3`)
- Menu categories as tabs (ナンセット / ナン単品 / サブメニュー / ドリンク …)
- Item options (name + extra price) selectable before adding to cart
- **Out-of-stock (欠品) items are greyed out and cannot be ordered**
- Cart, special notes, submit order
- Real-time status: 受付 → 調理中 → 提供済み
- **「店員を呼ぶ」** (Call Staff) button, which alerts the register screen
- At the end of the page: **領収書が必要ですか？** checkbox → addressee name input (宛名). Save it with the order and show it on the checkout screen.

**2. Kitchen Display (KDS)**
- Real-time new orders with sound alert, flashing card, and **voice announcement** (Web Speech API, e.g., 「3番テーブル、新規注文です」)
- Show: table no., order time, items, quantity, options, notes. **No prices.**
- **Each food item is displayed/printed as a separate ticket (one item per ticket)**
- Buttons: 「調理開始」 and 「完成」
- **Auto-print kitchen ticket directly on a kitchen printer** when an order arrives (compact size, one item per slip)

**3. Register / POS**
- Live table list with running totals; per-table order history
- Alert when a customer presses 「店員を呼ぶ」
- Checkout: payment method (現金 / PayPay / クレジットカード), discount (¥ or %), close table
- **Print receipt (レシート)**. If 領収書 was requested, print a receipt with the addressee name (宛名).
- **Daily sales summary (日次集計)**: totals by Cash / Credit / PayPay, order count, discounts, printable

**4. Menu Management page (separate)**
- List, add, edit, and delete (Remove) items
- Fields: ID, Name, Category, Price (¥), Options (name / extra price, with an "+ OPTION" button)
- 欠品 toggle per item
- Seed the DB with the menu data below

**5. Inventory page (棚卸 / Tanaoroshi, separate)**
- Stock quantity per item; **stock decreases automatically with each order**
- When stock reaches **0 → auto 欠品**
- When stock is **below 5 → low-stock warning** (残りわずか)
- Manual stocktake entry (actual count vs system count, with the difference shown)

**6. Finance page (separate)**
- Sales (売上), purchases/expenses (経費), labor cost (人件費), other costs
- Daily/monthly **profit & loss** (利益 / 損失), with a simple chart
- Data entry forms plus CSV export

### Seed Menu Data (JSON)
```
80 チーズナンセット / ナンセット / 1045
81 バターチキンセット / ナンセット / 990
82 ほうれん草セット / ナンセット / 990
83 サントリー生ビールとチキンティッカ（2個） / サブメニュー / 800
84 プレーンナン / ナン単品 / 300
85 チーズナン / ナン単品 / 660
86 ガーリックナン / ナン単品 / 440
87 ごまナン / ナン単品 / 440
88 チョコナン / ナン単品 / 550
89 ハニーナン / ナン単品 / 440
90 ハニーチーズナン / ナン単品 / 770
91 味まる屋スペシャルセット / ナンセット / 1980
92 チキンティッカ 2個 / サブメニュー / 330
93 チキンティッカ 5個 / サブメニュー / 660
94 チキンチリ / サブメニュー / 990
95 タンドリーチキン / サブメニュー / 450
96 タンドリーチキン / サブメニュー / 800
97 ラッシー / ドリンク / 330
98 マンゴーラッシー / ドリンク / 440
```
Each item has `soldOut:false`, `stock`, `options:[]`.

### Output Rules
- Provide the full code for every file (no placeholders)
- Show the folder tree first, then the schema, then each file
- Include print CSS for kitchen tickets (80mm) and receipts
- Add basic security (staff PIN for the KDS, POS, Menu, Inventory, and Finance pages; the customer page is public)

---

**Assumptions I made from your notes (please check):**
- 「ryouri kati 6 seete gharne order ma ghaye ghatdai jane」 → I read this as stock decreasing with each order.
- 「5 wata vanda tala」 → low-stock warning below 5.
- 「PACHIKO」 → I couldn't tell what this means, so I treated it as the daily sales summary (集計).
プロンプト追加分:お客様画面・キッチン画面の変更
QRコード式レストラン注文・POSシステムのプロンプトに対する追加指示です。メインプロンプトの Customer UI と Kitchen Display のセクションをこの内容で置き換えるか、「Update」としてメインプロンプトの後ろに貼り付けてください。
Customer UI の変更点
• 「店員を呼ぶ」 ボタンは、レジ画面に呼び出しを送信します(アラート+サウンド)。
• 受け取り通知: キッチンが注文に対して「カウンターへ取りに来てください」を押すと、お客様の画面に大きなバナーを即時表示します(ブラウザが許可する場合は短いバイブレーションまたは音も)。
  🍛 お料理ができました。カウンターまで取りに来てください。
• 注文ステータスの流れ: 受付 → 調理中 → 完成(カウンターへ) → 提供済み
• テーブル会計完了時に、お礼のバナー「ありがとうございました」を表示します。
Kitchen Display (KDS) の変更点
各チケットと上部ツールバーに次のボタンを追加します。
チケットごとのボタン
• 「調理開始」: ステータスが「調理中」になります。
• 「完成」: ステータスが「完成」になります。
• 「📣 カウンターへ取りに来てください」: そのテーブルのお客様画面に取りに来てほしいメッセージを送ります。再度押して再通知でき、ステータスは自動的に「完成」になります。
上部ツールバーのボタン(クイックアナウンス)
• 「いらっしゃいませ」: Web Speech API(ja-JP)で、キッチン/店内スピーカーから音声アナウンスを流します。
• 「ありがとうございました」: 同じ方法で音声アナウンスを流します。
• 任意設定: メッセージを全お客様画面に短いバナーとしても表示するオプション。
技術メモ
• メッセージはDBの /tables/{n}/notice に {type: "pickup", orderId, timestamp} の形式で保存します。お客様画面はこのパスをリアルタイムで監視し、「受け取りました」をタップしたらクリアします。
• ブラウザは操作があるまで音声を再生できないため、KDSに初回のみの 「🔊 音声を有効にする」 ボタンを設置します。
• 既存機能は維持します: 効果音アラート、点滅カード、新規注文の音声アナウンス、1品1チケット、価格非表示、自動印刷。
確認してほしい前提
• 「oseru Buttom」は、押せるボタンと解釈しました。「いらっしゃいませ」「ありがとうございました」は、キッチン端末から店内に流す音声アナウンスにしています。
• これらのメッセージをお客様画面だけに表示したい場合は、その行を変更しますので教えてください。
• 「キチン bata gharna milne」は、キッチンから「カウンターまで取りに来てください」の指示をお客様に送れる、と解釈しました。


# nagoya
