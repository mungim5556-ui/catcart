# 🍎 CatCart 맥 앱 만들기 (Xcode)

웹 게임(`dist/`)을 맥 앱 창(WKWebView) 안에서 띄우는 방식이에요. 게임 코드는 그대로 쓰고, Swift 파일 2개만 추가합니다.

## 준비물
- Xcode (App Store에서 무료 설치)
- Node.js (게임 빌드용, 이미 설치했다면 OK)

## 처음 한 번: 실행하기

Xcode 프로젝트(`macos/CatCart.xcodeproj`)가 이미 들어 있어요. Swift 파일 · 앱 아이콘 자리 · 샌드박스 설정 · `dist` 폴더 참조까지 연결돼 있어요.

1. **게임 빌드** — 터미널에서 저장소 폴더로 가서:
   ```bash
   npm install
   npm run build
   ```
   → `dist/` 폴더가 생겨요 (앱이 이 폴더를 그대로 담아요).

2. **Xcode로 열기** — `open macos/CatCart.xcodeproj`

3. **서명** — CatCart 타깃 → **Signing & Capabilities** → Team: 본인 Apple ID 선택
   (Bundle Identifier `com.mungim5556.catcart`가 이미 쓰이고 있다고 나오면 다른 이름으로 바꾸세요)

4. **실행** — ⌘R 누르면 CatCart 창이 떠요! 🐱

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
