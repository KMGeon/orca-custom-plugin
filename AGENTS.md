# Orca 플러그인 작성 노트

Orca 소스에서 확인한 플러그인 API의 사실입니다 (pluginApi 1, Orca 1.4.x). 새 플러그인을 설계하기 전에 읽으세요.

## 구조

- **패널**: sandbox iframe입니다. CSP가 `connect-src 'none'; script-src 'unsafe-inline'`라서 네트워크도 외부 스크립트도 안 됩니다. 필요한 JS와 데이터는 HTML 안에 인라인으로 넣어야 합니다.
- **워커** (`main`): Orca의 Electron 바이너리 위에서 도는 신뢰된 Node 프로세스입니다. `fetch`, 파일, 자식 프로세스를 그대로 쓸 수 있습니다. 환경 변수는 `PATH`, `HOME` 등 허용 목록만 넘어옵니다.
- **Host API**: `orca.host.call(method, params)`. 권한별 메서드는 Orca의 `src/shared/plugins/plugin-host-api.ts`가 기준입니다.

## 꼭 알아야 할 제약

- **패널과 워커 사이에 통로가 없습니다.** 패널은 `workspace.readContext`, `terminal.sendText`, `notifications.show`만 부를 수 있습니다. 이벤트, storage, settings는 워커 전용입니다.
  - 우회: 워커가 패널 HTML을 다시 쓰면, 개발 경로 설치에서는 Orca가 패널을 다시 불러옵니다. 이때 패널 상태가 초기화됩니다.
  - git이나 마켓에서 설치한 플러그인은 내용 무결성 검사를 받으므로 이 우회를 쓸 수 없습니다.
- **워커는 지연 시작되고, 5분 동안 활동이 없으면 회수됩니다.** 활동으로 치는 것은 host 호출, 명령 응답, 이벤트 ack입니다. 워커 안의 타이머는 활동으로 치지 않습니다. 계속 돌아야 하면 주기적으로 읽기 host 호출(`storage.keys` 등)을 하세요.
- **변경 host 호출은 감사 로그에 남습니다** (`storage.set`, `terminal.sendText` 등). 주기적으로 호출하는 건 읽기 메서드로 하세요.
- **이벤트는 3종뿐입니다**: `worktree.created`, `worktree.removed`, `agent.status.changed`.
- **패널 디자인 토큰**: `--background`, `--foreground`, `--card`, `--secondary`, `--muted-foreground`, `--primary`, `--border`, `--destructive` 등을 Orca가 주입합니다. 폰트는 `data:`만 허용되므로 시스템 폰트를 쓰세요.
- **`terminal.sendText`는 반드시 특정 터미널 id로 보냅니다.** 에이전트 터미널을 고르면 그 에이전트의 입력창에 글자가 들어갑니다.

## 설치 방식

- **일반 설치**(로컬 경로, git, 마켓)는 플러그인을 `<userData>/plugins/<publisher>.<id>/<내용 해시>/`로 복사해서 실행합니다. 복사본은 감시하지 않고, 내용이 바뀌면 무결성 검사에 걸립니다.
- **개발 설치**(설정 → 플러그인 → 개발 → 경로 추가)는 원본 폴더에서 실행하고, 파일이 바뀌면 패널을 다시 불러옵니다. 자기 파일을 다시 쓰는 플러그인은 이 방식으로만 동작합니다.
- git 설치는 저장소 **루트**의 `orca-plugin.json`만 읽습니다. 하위 폴더 지정은 안 됩니다.

## 에이전트 데이터 출처 (공개 API 아님)

- `<userData>/agent-hooks/last-status.json`: 패널별 최신 에이전트 상태입니다. `entries[paneKey].payload.subagents`에 실행 중인 서브에이전트가, `providerSession.transcriptPath`에 Claude 세션 기록 경로가 있습니다. `paneKey`는 `orca terminal list`의 `tabId:leafId`입니다.
- Claude 세션 기록 옆 `<세션>/subagents/agent-<id>.meta.json`: 서브에이전트의 `agentType`, `description`, `spawnDepth`입니다.
- `~/.claude/teams/<팀>/config.json`(멤버), `inboxes/<받는사람>.json`(메시지 `from`, `text`, `timestamp`)입니다.
- 모두 형식이 바뀔 수 있으니 필드를 전부 선택 사항으로 다루세요.

## orca CLI 사용

- 워커에서 Orca 데이터를 더 읽어야 하면 `orca … --json`을 실행합니다. 환경 변수가 비워진 상태에서도 동작합니다.
- CLI 경로는 워커 바이너리 기준으로 찾습니다. macOS에서는 `Contents/MacOS/Orca` 옆의 `../Resources/bin/orca`입니다 (`plugins/agent-flow/lib/orca-cli.mjs` 참고).
- 응답은 `{ ok, result | error }` 모양입니다.
