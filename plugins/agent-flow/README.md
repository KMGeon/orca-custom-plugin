# Agent Flow

Orca 오케스트레이션 run을 흐름 그래프로 보여 주는 오른쪽 패널입니다.

- **노드**: 에이전트입니다. 열은 위임 깊이를 뜻합니다 (코디네이터 → 작업자 → 하위 작업자).
- **선**: 두 에이전트 사이의 최근 일을 보여 줍니다. 시킴, 질문, 답변, 완료, 실패, 메시지, 핸드오프로 구분됩니다. 최근 90초 안에 일어난 일은 굵게 흐르는 선으로 표시됩니다.
- **재생 바**: run의 처음부터 흐름을 다시 봅니다.
- **하단**: 활동 기록과 태스크 목록입니다. 노드를 누르면 그 에이전트가 시킨 일과 받은 일이 나옵니다.

## 동작 방식

1. `agent.status.changed` 이벤트가 오면 워커가 깨어납니다.
2. 워커가 `orca orchestration run-list / task-list / dispatch-show / inbox`와 `orca terminal list`로 최근 run 6개를 읽습니다.
3. 데이터를 `panel/template.html`에 넣어 `panel/index.html`을 다시 씁니다. 내용이 바뀔 때만 씁니다.
4. 진행 중인 run이 있으면 3초마다, 없으면 15초마다 다시 읽습니다. 10분 동안 조용하면 멈추고, 다음 에이전트 이벤트에 다시 시작합니다.

명령 팔레트의 **Agent Flow: 새로고침**으로 바로 갱신할 수도 있습니다.

## 권한

| 권한 | 이유 |
|---|---|
| `events:subscribe` | 에이전트 상태가 바뀔 때 갱신하기 위해 |
| `storage` | 워커가 회수되지 않도록 읽기 호출을 하기 위해 (쓰지 않음) |

## 한계

- **개발 경로 설치 전용입니다.** 패널 HTML을 다시 쓰는 방식이라 git이나 마켓 설치에서는 동작하지 않습니다.
- **갱신 때 패널이 다시 로드됩니다.** 선택한 노드와 재생 위치가 초기화됩니다.
- **로컬 `orca` CLI 기준입니다.** macOS에서만 확인했습니다. Linux는 확인하지 않았고, Windows는 `orca.cmd` 실행을 아직 지원하지 않습니다.
- Claude 에이전트 팀(`~/.claude/teams`)은 아직 읽지 않습니다.

## 개발

```sh
node scripts/render.mjs                    # 빈 대기 화면을 panel/index.html에 씀
node scripts/render.mjs --live /tmp/x.html # 실제 오케스트레이션 데이터로 렌더링
```

워커가 `panel/index.html`을 계속 고치므로, git에서 그 변경을 무시하려면 이렇게 하세요.

```sh
git update-index --skip-worktree plugins/agent-flow/panel/index.html
```
