# AI HW HUB — 專案管理 Web App

一站式專案管理平台（V1.0 骨架），包含用戶登入、專案 CRUD、任務管理，全部以 **Firebase（Authentication + Cloud Firestore）** 做後端，毋須自建 server。

## 技術棧

| 範疇 | 工具 |
|---|---|
| 前端框架 | React 19 + TypeScript |
| 構建工具 | Vite |
| 路由 | React Router v7 |
| 登入 | Firebase Authentication（Email/Password + Google） |
| 資料庫 | Cloud Firestore |
| Lint | oxlint |

## 快速開始

```bash
npm install
npm run dev        # 開發伺服器（預設 http://localhost:5173）
npm run build      # TypeScript 檢查 + 打包
npm run lint       # oxlint 檢查
npm run preview    # 預覽打包結果
```

> 未設定 Firebase 之前，app 照樣可以啟動；登入頁會顯示設定指引。

## Firebase 設定步驟

1. 去 [Firebase Console](https://console.firebase.google.com/) → **Add project**。
2. 喺專案入面 → **Project settings（齒輪）→ Your apps → Web（`</>`）** 新增 Web App，會見到一個 `firebaseConfig`。
3. **Build → Authentication → Sign-in method**：啟用 **Email/Password**；想用 Google 登入就同時啟用 **Google**。
4. **Build → Firestore Database → Create database**（生產模式選 test mode 亦可以，但務必快啲加返 Security Rules）。
5. 喺專案根目錄：
   ```bash
   cp .env.example .env
   ```
6. 用第 2 步攞到嘅數值填好 `.env`，然後重新啟動 `npm run dev`。

### 預設資料結構（Firestore）

```
projects/{projectId}
  ├── name        : string
  ├── description : string
  ├── ownerId     : string      # 建立者 uid
  ├── memberIds   : string[]    # 成員 uid 列表（查詢用 array-contains）
  ├── status      : 'active' | 'completed' | 'archived'
  ├── createdAt   : number      # Unix 毫秒
  └── updatedAt   : number

tasks/{taskId}
  ├── projectId   : string
  ├── title       : string
  ├── description : string
  ├── status      : 'todo' | 'in_progress' | 'done'
  ├── createdBy   : string
  └── createdAt   : number
```

### Security Rules（好重要！）

唔設 rules 之前所有資料公開。最簡版本：只有成員先讀到專案、只有 owner 先刪得。貼入 **Firestore → Rules**：

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isSignedIn() {
      return request.auth != null;
    }
    function isMember(projectId) {
      return isSignedIn()
        && get(/databases/$(database)/documents/projects/$(projectId)).data.memberIds.hasAny([request.auth.uid]);
    }

    match /projects/{projectId} {
      allow read: if isSignedIn() && request.auth.uid in resource.data.memberIds;
      allow create: if isSignedIn();
      allow update: if isSignedIn() && request.auth.uid in resource.data.memberIds;
      allow delete: if isSignedIn() && resource.data.ownerId == request.auth.uid;

      match /tasks/{taskId} {
        allow read: if isMember(projectId);
        allow create, update, delete: if isMember(projectId);
      }
    }
  }
}
```

## 專案結構

```
src/
├── main.tsx                # 入口：Router + AuthProvider
├── App.tsx                 # 路由定義
├── index.css               # 全局樣式
├── firebase/config.ts      # Firebase init（讀取 .env）
├── context/
│   ├── AuthContext.tsx     # 登入狀態 + 登入/註冊/登出邏輯
│   └── useAuth.ts          # useAuth() hook
├── components/
│   ├── ProtectedRoute.tsx  # 路由守衛
│   └── AppHeader.tsx       # 頂部 bar
├── pages/
│   ├── LoginPage.tsx       # 登入 / 註冊 / Google 登入
│   ├── DashboardPage.tsx   # 專案列表 + 開新專案
│   └── ProjectPage.tsx     # 專案詳情 + 任務管理
├── services/
│   ├── projectService.ts   # Firestore 專案 CRUD
│   └── taskService.ts      # Firestore 任務 CRUD
└── types/index.ts          # Project / Task 型別 + 狀態標籤
```

## 而家做到 / 未做

**已做到**
- Email/Password 註冊及登入、登出、Google 登入
- 未登入自動 redirect 去 `/login`
- 建立/列出專案、建立任務、改任務狀態、刪任務
- 未有 `.env` 時顯示設定指引，唔會 crash

**下一步建議**
- 邀請成員（加 uid 入 `memberIds`）、任務指派、到期日
- Firestore 即時更新（`onSnapshot`）
- Firebase Hosting 部署
- 「AI HW」功能：接入 LLM API（例如自動拆任務、功課解答/建議），注意 API key 要放後端或 Cloud Functions
- 用 Ant Design / MUI 換成更完整嘅元件庫

## 授權／備註

呢個係內部專案骨架，請確保 `.env` 唔好 commit（已加入 `.gitignore`）。
