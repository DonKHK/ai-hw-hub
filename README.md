# AI HW HUB — AI Workflow 監控平台

一站式平台：**監控 Dashboard**（首頁）＋ **兩種登入方法** ＋ **AI Workflow 計劃填報**。

1. **AAI Portal 式登入**（原有）：揀身份 + 密碼，session 存本機 `localStorage`
2. **Firebase 登入**（新加）：Email + 密碼，3 個 login level 由 Firestore
   `users/{uid}` 決定

> **AI 計劃**存喺 Firestore（跨單位共用）；登入 session 存本機 `localStorage`。
> 只有 Firebase 登入呢條路先需要 `.env`；唔填都照用得（登入頁會顯示設定指引）。

Portal 登入機制由「AAI AI Homework Follow-up」webapp 抽出（`src/lib/portalData.ts`）。
**身份清單同密碼全部由 `.env` 提供**（`VITE_PORTAL_*`），**唔會 commit 落 repo**。

## 技術棧

| 範疇 | 工具 |
|---|---|
| 前端框架 | React 19 + TypeScript |
| 構建工具 | Vite |
| 路由 | React Router v7 |
| 登入 | ① AAI Portal 式（揀身份 + 密碼）　② Firebase Email／密碼（3 個 login level） |
| 資料 | Firestore（AI 計劃，跨單位共用）＋ localStorage（登入 session） |

## 快速開始

```bash
npm install
npm run dev        # 開發伺服器（預設 http://localhost:5173）
npm run build      # TypeScript 檢查 + 打包
npm run lint       # oxlint 檢查
```

想用 **Firebase 登入**先要（可選，唔填都可以用 Portal 登入）：

```bash
cp .env.example .env   # 填入 Firebase「AI Homework」專案嘅 Web App 設定
# 然後重啟 npm run dev
```

## 登入資料（由 `.env` 提供，唔會入 repo）

本專案**唔會**喺原始碼寫死任何密碼或單位名。要喺本機 `.env` 填：

| 變數 | 用途 |
|---|---|
| `VITE_PORTAL_DEPT_NAMES` | 部門清單（逗號分隔） |
| `VITE_PORTAL_BUSINESS_NAMES` | 業務單位清單（逗號分隔） |
| `VITE_PORTAL_CEO_PASSWORD` | CEO 登入密碼 |
| `VITE_PORTAL_STEERING_PASSWORD` | Read-only Steering 登入密碼 |
| `VITE_PORTAL_UNIT_PASSWORD_SUFFIX` | 單位密碼尾碼（單位英文名頭 3 個字母 + 尾碼） |

> ⚠️ 冇填 = **登入唔到**（fail-closed）。登入頁會顯示「Portal sign-in is not
> configured」提示，唔會誤放人入。
>
> 想加減身份 → 改 `.env` 兩個清單就得，**唔需要改 code**。
>
> 身份類別：2 個 Role（CEO／Read-only Steering，固定）＋ 部門 ＋ 業務單位，
> 格式定義喺 `src/lib/portalData.ts`。

## Firebase 登入（新加）＋ 3 個 login level

登入頁有兩個 tab：**AAI Portal 身份**（原有）／**Firebase 帳號**（新加）。
Firebase 用 Email + 密碼，登入後會讀 Firestore `users/{uid}` 攞角色（level）。

| # | Login level | 睇到嘅 workflow | 做得到嘅嘢 |
|---|---|---|---|
| 1 | `superadmin` | 全部單位 | 全部 |
| 2 | `admin` | 自己綁定單位 | 管理自己單位 |
| 3 | `user` | 自己綁定單位 | 只做自己嘅嘢 |

### 1. Firebase Console 設定（專案：AI Homework）

1. Authentication → Sign-in method → 開啟 **Email/Password**
2. Authentication → Users → 加測試帳號
3. Firestore Database → 建 `users` collection
   （**文件 ID 一定要係 Authentication 度嗰個 UID**）：

```json
{
  "email": "superadmin@example.com",
  "displayName": "Super Admin",
  "role": "superadmin",
  "unit": null,
  "isActive": true
}
```

`admin` / `user` 一定要填 `unit`，而且**要同 `src/lib/localInventory.ts`
嘅單位名一字不差**（例：`Innovation and Development Department (I&DD)`），
否則會抽唔到 workflow。

4. Firestore → Rules → 貼上 `firestore.rules` 嘅內容（前端只准讀自己、唔准寫）
   > ⚠️ `firestore.rules` **唔會 commit 落呢個 repo**（公開 repo 唔想暴露
   > 「邊啲 collection 開放讀寫」）—— 規則內容請向管理員索取。

### 2. `.env`

複製 `.env.example` 做 `.env`，填入：

- `VITE_FIREBASE_*` —— Firebase Web App 設定（想用 Firebase 登入先需要）
- `VITE_PORTAL_*` —— Portal 身份清單同密碼（想用 Portal 登入先需要）
- `VITE_PORTAL_SUPABASE_*` —— Portal workflow 來源（可選；唔填就用本機 inventory）

**改完要重啟** `npm run dev`（Vite 唔會 hot-reload `.env`）。

### 3. ⚠️ 安全提醒

呢個 Vite SPA **冇後端**，所以 Firebase 角色判斷只係**前端 UI gate**
（同 Portal 密碼一樣，唔係真正安全鎖）。要真鎖就要靠 `firestore.rules`
撳住實際資料，或者搬上 Cloud Functions。

## 資料結構

### Firestore `aiPlans`（跨用戶／跨裝置共用）

```ts
// collection: aiPlans ／ doc ID: {ownerId}__{workflowCode}
interface AiPlan {
  id: string
  workflowCode: string       // 例 "1A-001"
  workflowName: string
  unit: string               // 要對得上 localInventory 嘅單位名
  ownerId: string            // Portal 身份 id 或 "fb:<uid>"
  ownerName?: string         // 顯示名快照（dashboard 用）
  plan: string               // AI 打算點做（PLAN）
  inputData: string
  outputData: string
  steps: Array<{ name: string; due: string; dueDate?: string | null }>
  status?: 'selected' | 'in_progress' | 'done'
  painPoints: string[]
  supports: string[]
  createdAt: number           // Unix 毫秒
  updatedAt: number
}
```

### localStorage（登入 session ＋ 本機鏡像）

```ts
// key: ai-hw-hub.session.v1（Portal 登入 session）
{ id: string; name: string; kind: 'ceo' | 'readonly' | 'dept' | 'business' }

// key: ai-hw-hub.authProvider.v1（'portal' | 'firebase'）
// key: ai-hw-hub.ai-plans.v1（AI 計劃本機鏡像／離線 fallback）
```

## 專案結構

```
src/
├── main.tsx                # 入口：Router + AuthProvider
├── App.tsx                 # 路由定義
├── index.css               # 全局樣式
├── lib/portalData.ts       # Portal 身份清單 + 密碼（全部讀 .env，唔會入 repo）
├── lib/access.ts           # 統一 access model（Portal + Firebase 共用）
├── lib/firebaseRoles.ts    # 3 個 login level 嘅定義／標籤
├── lib/planStatus.ts       # ★ 計劃狀態／到期推導（就到期、已到期）
├── lib/localInventory.ts   # 1A Saved Workflow Inventory（本機，按單位過濾）
├── firebase/
│   ├── config.ts           # Firebase 初始化（冇 .env 時安全降級，唔會 crash）
│   └── authService.ts      # Email／密碼登入 + Firestore 角色讀取
├── context/
│   ├── authContext.ts      # Auth context 型別
│   ├── AuthProvider.tsx    # 兩種登入狀態 + session（localStorage + Firebase）
│   └── useAuth.ts          # useAuth() hook
├── components/
│   ├── AiPlanForm.tsx      # AI 計劃表單（單條頁 & wizard 共用）
│   ├── FirebaseLoginForm.tsx    # Firebase 登入表單（登入頁 tab 2）
│   ├── FirebaseSetupNotice.tsx  # 未設 .env 時顯示設定指引
│   ├── MonitorFilters.tsx       # ★ 監控頁篩選（已到期／就到期／未開始…）
│   ├── UnitPlanDetail.tsx       # ★ 監控頁：單位展開嘅計劃 + timeline
│   ├── ProtectedRoute.tsx  # 路由守衛（未登入跳 /login）
│   └── AppHeader.tsx       # 頂部 bar
├── pages/
│   ├── LoginPage.tsx       # 登入：兩個 tab（AAI Portal 身份 / Firebase 帳號）
│   ├── MonitorPage.tsx     # ★ 首頁：監控 Dashboard（所有 BU/DEPT 進度）
│   ├── WorkflowsPage.tsx   # 登入後抽 Workflow（/workflows）+ 多選 workflow
│   ├── AiPlanWizardPage.tsx# 逐條填 AI 計劃（/workflows/ai-plan?codes=…）
│   └── AiPlanPage.tsx      # 單條 AI 計劃（/workflows/:code/plan）
├── services/
│   ├── workflowService.ts  # 抽 Workflow（跟 access 由本機 inventory 過濾）
│   ├── aiPlanFirestore.ts  # ★ AI 計劃 Firestore 存取（監控 dashboard 資料源）
│   └── aiPlanService.ts    # AI 計劃 CRUD（Firestore 優先，fallback localStorage）
└── types/index.ts          # AppUser / AiPlan 型別 + 狀態標籤
```

## 監控 Dashboard（首頁）

登入後首頁係監控台（`/`），睇晒所有 BU/DEPT：

- **KPI 卡**：單位總數 / 已揀 Flow 嘅單位 / 已入 AI 方法 / 就到期 / 已到期
- **單位監控表**：每個 BU/DEPT 一行 —— workflow 數、已揀 Flow、已入 AI 方法、最近到期、狀態
- **展開明細**：撳單位嗰行 → 每條 workflow 嘅狀態、填報人、Plan 嘅開始／完成日期、每個 step 嘅 timeline（如期／就到期／已到期）
- **篩選**：全部 / 需要跟進 / 已到期 / 就到期 / 已揀未填 / 未開始 / 進行中 / 已完成

> **「到期點」有兩層**，兩者一齊計（見 `src/lib/planStatus.ts`）：
> 1. 每個 **step** 嘅 due date（`step.dueDate`，舊資料用 `step.due`）
> 2. **Plan details 嘅 end date**（`plan.endDate`）—— 整條計劃嘅大限
>
> 所以 KPI 嘅「就到期／已到期」、單位狀態、篩選數字、「最近到期」欄，
> 都會包含過咗 plan end date 嘅計劃（唔再只係睇 step）。

### 狀態定義

| 狀態 | 條件 |
|---|---|
| 未開始 | 完全冇計劃記錄 |
| 已揀 Flow（未填） | 有記錄但 `plan` 空白 |
| 進行中 | 已填，所有到期點（step due ＋ Plan end date）都 > 14 日 |
| 就到期 | 有 step **或 Plan details end date** 喺 **14 日內**到期（改 `DUE_SOON_DAYS` 可調） |
| 已到期 | 有 step **或 Plan details end date** 已經過期 |
| 已完成 | AI 計劃表單揀咗「已完成」，或者全部 step 都 Done（完成後唔會再因為過期而變「已到期」） |

### 權限視圖（兩種登入方法係**唔同工種**）

| 登入方法 | 身份 | 監控 Dashboard | 抽 Workflow |
|---|---|---|---|
| Portal | CEO | 全部單位 | 全部 |
| Portal | Read-only Steering | 全部單位 | 全部 |
| Portal | Dept（例 I&DD） | ❌ 跳去 Workflows | ✅ **只抽自己部門** |
| Portal | Business | ❌ 跳去 Workflows | ✅ **只抽自己部門** |
| Firebase | Superadmin | 全部單位 | 🚫 **冇** |
| Firebase | Admin | 只睇自己綁定單位 | 🚫 **冇** |
| Firebase | User（觀察員） | 全部單位（read-only） | 🚫 **冇** |

> **核心規則**：**所有 Firebase 帳號**（Superadmin／Admin／User）都係
> 管理員／觀察員 → **永遠冇 workflow**。
> 只有 **AAI Portal 身份**先抽到 workflow，而且只抽自己部門；
> 揀錯部門／單位 = **0 條**（fail-closed，唔會誤放全部）。

實作：`src/lib/access.ts` 用**兩個獨立 scope** ——
`monitorScope`（監控範圍）同 `workflowScope`（抽 workflow 範圍）。

### 資料來源

AI 計劃存喺 Firestore `aiPlans`（唔再係淨係 localStorage），所以 superadmin
真係睇得到所有單位交咗咩。Doc ID 係 `{ownerId}__{workflowCode}`（天然 upsert）。

> ⚠️ 為咗令 Portal 用戶（冇 Firebase Auth）都寫得到，`aiPlans` 目前
> **開放讀寫**（見 `firestore.rules`）。安全性 Phase 2 會用匿名登入收緊。
> 改完規則記得喺 Console 重新發布。

### 本機舊資料上傳

Superadmin 喺監控頁會見到「同步本機資料（N）」掣 —— 將本機 localStorage
嘅舊 AI 計劃一次過上傳 Firestore（upsert，重複按都安全）。

## 部署（Vercel）

線上版本：**https://aihw-don.vercel.app**

### 專案設定檔

| 檔案 | 作用 |
|---|---|
| `vercel.json` | 用 Vite preset ＋ SPA `rewrites`（令 `/workflows`、`/monitor` 直接開／F5 唔會 404）＋ 兩個安全 header |
| `.vercelignore` | 上載排除清單 —— 特別確保 `.env` **唔會**上去 |

### ⚠️ 一定要設定 Environment Variables

Vercel **唔會**讀本機 `.env`。冇設定就會見到「Portal sign-in is not configured」，
而且 Firebase 登入唔到。要喺 **Vercel → Project → Settings → Environment Variables**
加入（Production / Preview 兩個環境都要）：

```
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_MEASUREMENT_ID

VITE_PORTAL_SUPABASE_URL
VITE_PORTAL_SUPABASE_ANON_KEY
VITE_PORTAL_UNITS_TABLE
VITE_PORTAL_WORKFLOWS_TABLE
VITE_PORTAL_UNIT_COL
VITE_PORTAL_UNIT_NAME_COL

VITE_PORTAL_DEPT_NAMES
VITE_PORTAL_BUSINESS_NAMES
VITE_PORTAL_CEO_PASSWORD
VITE_PORTAL_STEERING_PASSWORD
VITE_PORTAL_UNIT_PASSWORD_SUFFIX
```

> 改完環境變數要**重新部署**先生效（Vite 係 build-time 注入）。

### ☝️ Firebase Auth 授權網域

如果部署後 Firebase 登入報 `auth/unauthorized-domain`，
去 **Firebase Console → Authentication → Settings → Authorized domains**
加入 `aihw-don.vercel.app`。

> Portal 登入**唔受影響**（純前端驗證）。

### 🔒 安全提醒（重要）

Vite 係 **build-time** 注入環境變數，即係所有 `VITE_*` 值**都會 embed 落
前端 bundle**。即係任何訪客開 F12 都睇得到 Portal 密碼。

- 原始碼 repo 乾淨（`src/` 冇密碼），但**部署出嚟嘅網站唔係保密嘅**
- 要真正保護就要搬去後端（Phase 2）

### 本機手動部署

```bash
vercel link --yes --project aihw-don
vercel deploy --prod
```

> PowerShell 環境下建議加 `< nul`（例如 `vercel whoami < nul`），
> 避免 CLI 等緊輸入而卡住。

## 備註

- Session 存 `localStorage`（呢個 Vite SPA 冇 server），對應原本 Next.js 版嘅
  httpOnly cookie 做法；純前端登入只係 UI gate，正式對外環境建議搬返上後端驗證。
- **AI 計劃**已經上 Firestore（跨用戶／跨裝置共用）；登入 session 仍然係本機。
- 本機 `localStorage` 可能仲留住舊嘅 `ai-hw-hub.projects.v1` /
  `ai-hw-hub.tasks.v1`（已移除嘅專案功能），唔會再被讀取，可以自己清走。
