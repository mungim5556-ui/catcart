# 🍎 CatCart 맥 앱 만들기 (Xcode)

웹 게임(`dist/`)을 맥 앱 창(WKWebView) 안에서 띄우는 방식이에요. 게임 코드는 그대로 쓰고, Swift 파일 2개만 추가합니다.

## 준비물
- Xcode (App Store에서 무료 설치)
- Node.js (게임 빌드용, 이미 설치했다면 OK)

## 처음 한 번: 프로젝트 만들기

1. **게임 빌드** — 터미널에서 저장소 폴더로 가서:
   ```bash
   git pull
   npm install
   npm run build
   ```
   → `dist/` 폴더가 생겨요.

2. **Xcode 프로젝트 생성** — Xcode → File → New → Project → **macOS** 탭 → **App** → Next
   - Product Name: `CatCart`
   - Interface: **SwiftUI**, Language: **Swift**
   - 저장 위치: 이 `macos/` 폴더 (그러면 `macos/CatCart/CatCart.xcodeproj`가 생겨요)

3. **Swift 파일 교체** — Xcode가 만든 `CatCartApp.swift`, `ContentView.swift`의 내용을
   이 폴더에 있는 같은 이름 파일(`macos/CatCart/CatCartApp.swift`, `ContentView.swift`) 내용으로 바꿔 넣으세요.

4. **게임 파일 넣기** — Finder에서 저장소의 `dist` 폴더를 Xcode 왼쪽 파일 목록으로 드래그
   - **"Create folder references"** 선택 (파란색 폴더 아이콘이 되어야 해요)
   - **"Copy items if needed"는 체크 해제** (원본 `dist`를 참조해야 다시 빌드할 때 자동 반영돼요)
   - Add to targets: `CatCart` 체크

5. **네트워크 권한 (샌드박스)** — 프로젝트 설정 → CatCart 타깃 → **Signing & Capabilities**
   - App Sandbox는 켜진 채로 두세요 (게임은 인터넷을 쓰지 않아서 추가 권한 불필요)
   - Team: 본인 Apple ID 선택 (무료 계정도 내 맥에서 실행은 가능)

6. **실행** — ⌘R 누르면 CatCart 창이 떠요! 🐱

## 게임을 고친 뒤에는
```bash
npm run build
```
하고 Xcode에서 다시 ⌘R. (폴더 참조라서 새 `dist`가 자동으로 들어가요)

## 확인할 것
- 기록 · 고른 고양이/액세서리가 앱을 껐다 켜도 남아 있는지
- 키보드 조작 (창을 한 번 클릭해야 할 수도 있어요)
- 게임패드를 쓴다면 연결해서 동작하는지

## 배포하기
- **내 맥/지인에게:** Product → **Archive** → Distribute App → **Copy App** (또는 Developer ID로 서명·공증하면 경고 없이 실행)
- **Mac App Store:** Apple Developer Program 가입($99/년) → App Store Connect에 앱 등록 →
  Product → **Archive** → Distribute App → **App Store Connect** → 업로드 후 심사 제출
  - 타깃 General 탭에서 **App Category: Games**, 앱 아이콘(1024×1024)을 Assets의 AppIcon에 넣어주세요
