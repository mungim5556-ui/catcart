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

## 2. 게임에 서버 주소 알려주기

**웹 버전 (GitHub Pages)**
1. GitHub 저장소 → **Settings → Secrets and variables → Actions → Variables 탭 → New repository variable**
2. Name: `VITE_SERVER_URL`, Value: 위에서 복사한 주소
3. 다음 `git push` 부터 웹 게임에 🌐 온라인 대전이 켜져요 (Actions 탭에서 "Run workflow" 로 바로 다시 배포해도 돼요)

**맥 · 아이폰 앱**
저장소 맨 위 폴더에 `.env.production.local` 파일을 만들고 한 줄 적은 뒤 `npm run build`:
```
VITE_SERVER_URL=https://catcart-server.<내-이름>.workers.dev
```
(이 파일은 git에 올라가지 않아요.)

**잠깐 테스트만 할 때:** 게임 주소 뒤에 `?server=서버주소` 를 붙이면 그 서버로 접속해요.

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
