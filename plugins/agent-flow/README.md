# Agent Flow

에이전트끼리 누가 누구에게 무엇을 시켰는지 흐름 그래프로 보여 주는 오른쪽 패널입니다. 세 가지 흐름을 한 목록에서 고릅니다.

| 목록 배지 | 대상 | 데이터 |
|---|---|---|
| `[Orca]` | Orca 오케스트레이션 run, 그리고 각 작업자가 띄운 Claude 서브에이전트 | `orca orchestration` CLI + 아래 서브에이전트 데이터 |
| `[세션]` | 오케스트레이션 밖의 Claude 세션과 그 서브에이전트 (최근 24시간, 최대 4개) | Orca 훅 상태 파일 + Claude 세션 기록 |
| `[팀]` | Claude 에이전트 팀 (최근 3일, 최대 4개) | `~/.claude/teams/<팀>/` |

- **노드**: 에이전트입니다. 열은 위임 깊이를 뜻합니다 (코디네이터 → 작업자 → 하위 작업자).
- **선**: 두 에이전트 사이의 최근 일을 보여 줍니다. 시킴, 서브에이전트 생성, 질문, 답변, 완료, 실패, 메시지, 핸드오프로 구분됩니다. 서브에이전트 노드는 점선 테두리입니다. 최근 90초 안에 일어난 일은 굵게 흐르는 선으로 표시됩니다.
- **재생 바**: run의 처음부터 흐름을 다시 봅니다.
- **하단**: 활동 기록과 태스크 목록입니다. 노드를 누르면 그 에이전트가 시킨 일과 받은 일이 나옵니다.

## 동작 방식

1. `agent.status.changed` 이벤트가 오면 워커가 깨어납니다.
2. 워커가 데이터를 모읍니다.
   - `orca orchestration run-list / task-list / dispatch-show / inbox`, `orca terminal list`로 최근 run 6개
   - Orca의 `agent-hooks/last-status.json`에서 지금 돌고 있는 서브에이전트
   - Claude 세션 기록 옆 `subagents/*.meta.json`에서 끝난 서브에이전트까지 (`agentType`, 설명, 깊이, 시작·끝 시각)
   - `~/.claude/teams/<팀>/config.json`의 멤버와 `inboxes/*.json`의 메시지
3. 데이터를 `panel/template.html`에 넣어 `panel/index.html`을 다시 씁니다. 내용이 바뀔 때만 씁니다.
4. 진행 중인 run이 있으면 3초마다, 없으면 15초마다 다시 읽습니다. 10분 동안 조용하면 멈추고, 다음 에이전트 이벤트에 다시 시작합니다.

명령 팔레트의 **Agent Flow: 새로고침**으로 바로 갱신할 수도 있습니다.

## 권한

| 권한 | 이유 |
|---|---|
| `events:subscribe` | 에이전트 상태가 바뀔 때 갱신하기 위해 |
| `storage` | 워커가 회수되지 않도록 읽기 호출을 하기 위해 (쓰지 않음) |

## 한계

- **개발 경로 설치 전용입니다.** 설정 → 플러그인 → **개발**의 "경로 추가"로 설치하세요. 일반 설치는 Orca가 만든 복사본에서 돌기 때문에 패널이 처음 한 번만 그려지고 갱신되지 않습니다. 복사본에서 실행되면 워커는 아무것도 쓰지 않고 로그만 남깁니다.
- **Orca 내부 파일을 읽습니다.** `agent-hooks/last-status.json`은 공개 API가 아니라서, Orca가 형식을 바꾸면 서브에이전트가 안 보일 수 있습니다. 그때도 오케스트레이션 그래프는 그대로 나옵니다.
- **Claude 서브에이전트만 보입니다.** Codex 등 다른 에이전트의 하위 작업은 아직 읽지 않습니다.
- **Claude 팀 기록은 팀이 끝나면 지워지는 경우가 많습니다.** 실행 중에 보는 용도가 가장 정확합니다.
- **갱신 때 패널이 다시 로드됩니다.** 선택한 노드와 재생 위치가 초기화됩니다.
- **로컬 `orca` CLI 기준입니다.** macOS에서만 확인했습니다. Linux는 확인하지 않았고, Windows는 `orca.cmd` 실행을 아직 지원하지 않습니다.

## 개발

```sh
node scripts/render.mjs                    # 빈 대기 화면을 panel/index.html에 씀
node scripts/render.mjs --live /tmp/x.html # 실제 오케스트레이션 데이터로 렌더링
```

워커가 `panel/index.html`을 계속 고치므로, git에서 그 변경을 무시하려면 이렇게 하세요.

```sh
git update-index --skip-worktree plugins/agent-flow/panel/index.html
```
