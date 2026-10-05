# 🌐 CatCart 온라인 서버

로그인 · 닉네임 · 친구 · 초대 · 레이스 방을 맡는 서버예요.
**Cloudflare Workers + Durable Objects** 위에서 돌아가고, **무료 플랜**으로 충분해요.

## 1. 처음 한 번: 배포하기 (맥 터미널)

1. https://dash.cloudflare.com/sign-up 에서 Cloudflare 계정 만들기 (무료, 카드 필요 없음)
2. 터미널에서:
   ```bash
   cd catcart/server
   npm install
   npx wrangler login      # 브라우저가 열리면 "Allow" 클릭
   npx wrangler deploy
   ```
3. 마지막에 나오는 주소를 복사해 두세요. 예)
   ```
   https://catcart-server.<내-이름>.workers.dev
   ```
   브라우저로 열었을 때 `CatCart server 🐱` 가 보이면 성공!

## 1-2. 자동 배포 켜기 (처음 한 번, 추천)

이걸 해 두면 `server/` 코드가 바뀌어서 GitHub에 올라갈 때마다 **GitHub가 알아서 Cloudflare에 배포**해요.
(터미널에서 `wrangler deploy` 를 다시 칠 필요가 없어요)

1. **Cloudflare API 토큰 만들기**
   - https://dash.cloudflare.com/profile/api-tokens → **Create Token**
   - **"Edit Cloudflare Workers"** 템플릿 → **Use template**
   - Account Resources: 내 계정 / Zone Resources: **All zones** (그대로) → **Continue to summary → Create Token**
   - 나온 토큰을 복사 (한 번만 보여요!)
2. **Account ID 복사**
   - Cloudflare 대시보드 → **Workers & Pages** → 오른쪽에 있는 **Account ID** 복사
3. **GitHub에 비밀값으로 저장**
   - GitHub 저장소 → **Settings → Secrets and variables → Actions → New repository secret**
   - `CLOUDFLARE_API_TOKEN` = 1번 토큰
   - `CLOUDFLARE_ACCOUNT_ID` = 2번 ID
4. 확인: GitHub 저장소 → **Actions** 탭 → "Deploy server to Cloudflare" → **Run workflow** → 초록 체크 ✅ 면 성공!

⚠️ 토큰은 비밀번호와 같아요. 채팅이나 코드에 붙여넣지 말고 GitHub Secrets에만 넣으세요.

## 2. 게임에 서버 주소 알려주기

저장소 맨 위의 **`.env.production`** 파일에 주소가 적혀 있어요 (지금: `https://catcart-server.mungim5556.workers.dev`).
- 웹 버전: `git push` 하면 GitHub Pages가 이 주소로 빌드돼요
- 맥 · 아이폰 앱: `npm run build` 하면 이 주소가 들어가요
- 서버 주소가 바뀌면 이 파일만 고치면 돼요 (주소는 비밀이 아니라 올라가도 괜찮아요)

**잠깐 다른 서버로 테스트할 때:** 게임 주소 뒤에 `?server=서버주소` 를 붙이세요.

## 3. 내 컴퓨터에서 서버 돌려 보기 (개발용)

```bash
cd server
npm install
npm run dev        # http://localhost:8787
npm test           # 다른 터미널에서: 가입 · 친구 · 초대 · 방 · 레이스 중계 40가지 자동 점검
```
게임은 `http://localhost:5173/?server=http://localhost:8787` 로 열면 돼요.

## 무엇을 저장하나요?
| 데이터 | 설명 |
|---|---|
| 아이디 | 로그인용 (영어 소문자 · 숫자 · _) |
| 비밀번호 | **원문은 저장하지 않아요.** PBKDF2(SHA-256, 10만 번) 해시만 저장 |
| 닉네임 | 다른 사람과 겹치지 않게 (대소문자 구분 없이) |
| 친구 목록 · 요청 | 서로의 사용자 번호 |
| 로그인 세션 | 60일짜리 무작위 토큰 |

레이스 중 카트 위치 같은 실시간 데이터는 방 안에서 중계만 하고 저장하지 않아요.
**계정 삭제**(앱스토어 필수 기능)는 게임의 온라인 화면 → "계정 삭제" 에서 할 수 있고, 친구 관계까지 모두 지워져요.

## 보안 장치
- 비밀번호 5번 틀리면 1분 잠금, 같은 IP에서 1시간에 가입 10번까지
- 방은 **초대받은 사람만** 들어올 수 있어요 (방 코드를 알아도 초대 없이는 못 들어와요)
- 방 설정 · 시작 · 내보내기는 방장만, 컴퓨터 고양이 위치는 방장 게임만 보낼 수 있어요
- 메시지 크기 · 개수 제한 (초당 60개)

## 무료 플랜 한도 (2026년 기준, 바뀔 수 있어요)
Workers 하루 10만 요청, Durable Objects 무료 사용량 안에서 친구들과 즐기기엔 충분해요.
사용자가 많아지면 Cloudflare 대시보드에서 사용량을 확인하세요.

## 구조
```
src/index.ts   주소 나누기 (/api, /ws → Hub, /room/코드 → Room)
src/hub.ts     계정 · 닉네임 · 친구 · 접속 상태 · 초대 (SQLite 하나)
src/room.ts    레이스 방 하나 (설정 · 참가자 · 준비 · 시작 · 레이스 중계)
test/smoke.mjs 전체 흐름 자동 점검
```
