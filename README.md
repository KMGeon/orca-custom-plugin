# orca-custom-plugin

[Orca](https://github.com/stablyai/orca)에서 쓰는 개인 플러그인 모음입니다. 플러그인 하나가 `plugins/<id>/` 폴더 하나입니다.

| 플러그인 | 하는 일 |
|---|---|
| [agent-flow](plugins/agent-flow) | 오케스트레이션 run에서 어떤 에이전트가 누구에게 무엇을 시켰는지 흐름 그래프로 보여 줍니다 |

## 설치 (개발 경로)

1. 이 저장소를 클론합니다.
2. Orca → 설정 → 플러그인 → 개발 → **경로 추가**에서 `plugins/<id>` 폴더를 고릅니다.
3. Installed 탭에서 플러그인을 **검토 및 활성화**합니다.

개발 경로로 설치하면 파일을 고칠 때 Orca가 패널을 다시 불러옵니다.

## 테스트

```sh
npm test
```

외부 의존성은 없습니다. Node 20 이상의 내장 `node:test`만 씁니다.

## 새 플러그인 추가

1. `plugins/<id>/orca-plugin.json`을 만듭니다. `id`는 소문자와 `-`만 쓰고, `publisher`는 `kmgeon`으로 둡니다.
2. 필요한 권한만 `capabilities`에 넣습니다. 권한이 바뀌면 Orca가 다시 동의를 받습니다.
3. 테스트는 `plugins/<id>/test/*.test.mjs`에 둡니다. 루트 `npm test`가 자동으로 찾습니다.
4. 위 표에 한 줄을 추가합니다.

플러그인 API의 제약은 [AGENTS.md](AGENTS.md)에 정리했습니다. 만들기 전에 먼저 읽어 주세요.
