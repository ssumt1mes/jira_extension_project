# AES Jira Bot (Chromium Extension)

Jira 페이지 우측 하단에 챗봇 패널을 제공하는 Chrome/Chromium 확장입니다.  
현재 이슈의 관련 이슈를 단계별로 보여주고, 알림을 모아서 관리하며, 필요하면 로컬 LLM(OpenCode) 브릿지와 연결할 수 있습니다.

## 1. 주요 기능

- 현재 이슈 분석: `제품 -> 단계 -> 관련 이슈` 구조로 시각화
- 단계 진행 보조: `pass`, `fail`, `다음 step` 명령으로 테스트 흐름 기록
- 유사 이슈 추천: 현재 단계/이슈와 비슷한 과거 이슈 제안
- 알림 관리: `assignee/reporter/watcher` 기준 업데이트 알림 수집
- 알림 탭: 읽음/미읽음, 개별 삭제, 일괄 확인, 확인한 알림 일괄 삭제, `미확인만` 필터
- 채팅 기록 복원: 이슈별 대화 기록 로컬 저장/복원
- 로컬 브릿지 연동: 입력 메시지를 `localhost:4096` API로 전달 가능

## 2. 설치 및 실행

### 2.1 의존성 설치

```bash
cd /Users/dhwoo/Documents/extension
npm install
```

### 2.2 확장 로드

1. Chrome/Chromium에서 `chrome://extensions` 열기
2. `Developer mode` 활성화
3. `Load unpacked` 클릭
4. `/Users/dhwoo/Documents/extension` 선택
5. Jira 탭 새로고침

### 2.3 기본 확인

- 우하단 런처 아이콘 표시
- 패널 제목: `AES Jira Bot`
- 상단 탭: `채팅`, `알림`
- `알림` 탭에는 미확인 건수 배지 표시

## 3. 사용 가이드

### 3.1 채팅 탭

- 입력창에 명령을 입력하고 `전송`
- 퀵 액션 버튼으로 주요 기능 즉시 실행
- 이슈별 대화 기록 자동 복원

### 3.2 알림 탭

- 알림 목록을 모아서 확인
- 읽은 알림은 회색 처리
- `알림` 탭 버튼에 미확인 건수 배지 표시
- 지원 동작:
- `확인/미확인` 토글
- `삭제`
- `모두 확인`
- `확인한 알림 지우기`
- `새 알림 확인`
- `미확인만` 토글

## 4. 명령어

| 명령어 | 설명 | 예시 |
|---|---|---|
| `도움말` | 사용 가능한 명령어 목록 표시 | `도움말` |
| `새로고침` | 현재 이슈 재분석 | `새로고침` |
| `이슈 열기 ISSUE-KEY` | 특정 이슈 페이지로 이동 | `이슈 열기 SCRUM-12` |
| `추천 이슈 보여줘` | 유사 기능 이슈 추천 표시 | `추천 이슈 보여줘` |
| `알림 보여줘` | 알림 목록 표시 및 알림 탭 전환 | `알림 보여줘` |
| `지금 알림 확인` | 즉시 폴링 실행 | `지금 알림 확인` |
| `pass` | 현재 단계를 통과 처리 후 다음 단계 이동 | `pass` |
| `fail` | 현재 단계를 실패 처리 후 다음 단계 이동 | `fail` |
| `다음 step` | 판정 없이 다음 단계로 이동 | `다음 step` |

## 5. 이슈/단계 매핑 규칙

### 5.1 관련 이슈 수집

- Jira `issuelinks` 기반으로 수집
- `linkTypeFilter` 설정 시 해당 링크 타입만 사용

### 5.2 제품(Product) 판별 우선순위

1. `productFieldId`
2. `productLabelPrefix` 라벨
3. 없으면 `미분류`

### 5.3 단계(Step) 판별 우선순위

1. `stepFieldId`
2. `stepLabelPrefix` 라벨
3. `stepRegex` (summary fallback)
4. 없으면 `미지정`

## 6. 알림 동작

### 6.1 대상

- `assignee = currentUser()`
- `reporter = currentUser()`
- `watcher = currentUser()`

### 6.2 방식

- 백그라운드 서비스 워커 폴링
- 새 알림 발생 시:
- 브라우저 알림 표시
- 채팅창으로 실시간 반영
- 알림 탭 목록 업데이트

### 6.3 기본 JQL

```jql
(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser())
AND updated >= -{alertLookbackMin}m
ORDER BY updated DESC
```

## 7. 로컬 브릿지(OpenCode/LLM) 연동

### 7.1 개요

- `localBridgeEnabled=true`이면 사용자 입력을 로컬 API로 전달
- 기본 URL: `http://localhost:4096/api/chat`

### 7.2 요청 페이로드(요약)

- `userMessage`
- 현재 이슈 정보(`issue`)
- 단계 진행 정보(`stepContext`)
- 추천 이슈 요약(`recommendedIssues`)
- 알림 요약(`alertItems`)

### 7.3 응답 처리

아래 키 중 하나를 찾아 채팅에 출력합니다.

- `reply`
- `message`
- `text`
- `output`
- `data.reply`

## 8. 설정 키 설명

| 키 | 설명 |
|---|---|
| `productLabelPrefix` | 제품 라벨 접두어 |
| `stepLabelPrefix` | 단계 라벨 접두어 |
| `stepRegex` | 단계 라벨 미존재 시 summary 파싱 정규식 |
| `productFieldId` | 제품 커스텀 필드 ID |
| `stepFieldId` | 단계 커스텀 필드 ID |
| `linkTypeFilter` | 사용할 링크 타입(쉼표 구분) |
| `maxRelatedIssues` | 관련 이슈 최대 조회 수 |
| `jiraBaseUrl` | Jira 베이스 URL |
| `alertEnabled` | 알림 사용 여부 |
| `alertIntervalMin` | 알림 폴링 주기(분) |
| `alertLookbackMin` | 알림 조회 범위(분) |
| `localBridgeEnabled` | 로컬 브릿지 사용 여부 |
| `localBridgeUrl` | 로컬 브릿지 API URL |
| `localBridgeTimeoutMs` | 로컬 브릿지 타임아웃(ms) |

## 9. SCRUM 프리셋

아래 조건에서 SCRUM 프리셋이 기본 적용됩니다.

- 도메인: `https://dhwoo.atlassian.net`
- 이슈 키: `SCRUM-*`

대표 기본값:

- `productLabelPrefix=product:`
- `stepLabelPrefix=step:`
- `linkTypeFilter=Relates`
- `maxRelatedIssues=80`
- `alertIntervalMin=3`
- `localBridgeEnabled=true`

## 10. 테스트

```bash
cd /Users/dhwoo/Documents/extension
npx playwright install chromium
npm run test:e2e
```

## 11. 문제 해결

### 11.1 패널이 안 보일 때

1. `chrome://extensions`에서 확장 `Reload`
2. Jira 탭 새로고침
3. 사이트 접근 권한 확인

### 11.2 관련 이슈가 비어 있을 때

1. 해당 이슈에 `issuelinks` 존재 여부 확인
2. `linkTypeFilter` 과도 제한 여부 확인
3. 라벨 규칙(`product:`, `step:`) 확인

### 11.3 알림이 안 올 때

1. 브라우저 알림 권한 허용 여부 확인
2. Jira 로그인 세션 확인
3. `alertEnabled`, `jiraBaseUrl` 설정 확인

### 11.4 로컬 브릿지가 응답하지 않을 때

1. `localBridgeEnabled`가 켜져 있는지 확인
2. `localBridgeUrl`이 실제 엔드포인트인지 확인
3. `localhost:4096` 서버 상태 확인
4. 타임아웃(`localBridgeTimeoutMs`) 상향 조정

## 12. 주요 파일

- `manifest.json`: MV3 설정/권한
- `src/content/content.js`: 챗봇 UI, 이슈 분석, 단계 진행, 알림 탭
- `src/content/content.css`: 패널/탭/알림 스타일
- `src/background/service-worker.js`: 폴링/알림 저장/읽음 상태 처리
- `src/options/options.html`: 설정 화면
- `src/options/options.js`: 설정 저장/복원
- `src/options/options.css`: 설정 화면 스타일
- `tests/e2e/extension.spec.js`: Playwright E2E
