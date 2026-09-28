# 📱 CatCart 아이폰 · 아이패드 앱 (Xcode)

맥 앱과 같은 방식이에요 — 웹 게임(`dist/`)을 앱 안의 웹뷰(WKWebView)로 띄웁니다.
가로 화면 고정 · 전체 화면 · 기울기 조향 권한 자동 허용이 들어 있어요.

## 실행하기

1. **게임 빌드** — 저장소 폴더에서:
   ```bash
   npm install
   npm run build
   ```
2. **Xcode로 열기** — `open ios/CatCart.xcodeproj`
3. **서명** — CatCart 타깃 → **Signing & Capabilities** → Team: 본인 Apple ID
4. **실행 대상 고르기** (Xcode 위쪽 가운데)
   - **iPhone 시뮬레이터** — 화면 · 터치 버튼 확인 (기울기는 안 돼요)
   - **내 아이폰** — USB로 연결 → 아이폰에서 "이 컴퓨터 신뢰" →
     설정 → 개인정보 보호 및 보안 → **개발자 모드** 켜기 → ⌘R
     - 무료 Apple ID로 설치한 앱은 7일 뒤 다시 ⌘R 해야 해요
     - 처음 실행 때 "신뢰하지 않는 개발자"가 뜨면: 설정 → 일반 → VPN 및 기기 관리 → 내 Apple ID 신뢰
5. **⌘R** 🐱

## 게임을 고친 뒤에는
`npm run build` 하고 Xcode에서 다시 ⌘R.

## 게임 디버깅
Debug 빌드는 Safari 웹 속성 검사기로 볼 수 있어요:
맥 Safari → 설정 → 고급 → "웹 개발자용 기능 보기" → **개발자용** 메뉴 → 시뮬레이터/아이폰 → CatCart

## 배포하기
- **TestFlight (지인 테스트):** Apple Developer Program($99/년) → Product → **Archive** →
  Distribute App → **App Store Connect** → App Store Connect의 TestFlight 탭에서 테스터 초대
- **App Store:** 같은 업로드 빌드로 심사 제출
  - 앱 아이콘(1024×1024)을 Assets의 AppIcon에 넣어주세요
  - 스크린샷: 6.9인치 아이폰(가로) 필수, 아이패드도 지원하므로 13인치 아이패드 스크린샷도 필요
