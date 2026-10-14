# orca-custom-plugin

Orca 플러그인 모음 저장소입니다. 플러그인 하나가 `plugins/<id>/` 폴더 하나이고, master에 push하면 플러그인별 태그와 마켓플레이스 목록이 자동으로 만들어집니다.

플러그인 API의 제약은 아래 노트가 기준입니다.

@AGENTS.md

## 설치 방법

사용자에게 설치를 안내할 때는 플러그인 종류에 따라 아래 두 방법 중 하나만 안내합니다.

### 1. 마켓플레이스 설치 (일반 플러그인)

1. Orca → 설정 → 플러그인 → 마켓플레이스 추가에 저장소 주소를 넣습니다.
   - 비공개 저장소: `git@github.com:KMGeon/orca-custom-plugin.git` (SSH 키 필요)
   - 공개 저장소: `https://github.com/KMGeon/orca-custom-plugin.git`
2. 목록에서 플러그인을 고르고 **설치** → **검토 및 활성화**를 누릅니다.

마켓 목록은 `orca-marketplace.json`이고, 각 항목은 `<id>-v<version>` 태그를 가리킵니다. 태그는 `plugins/<id>` 폴더가 루트인 커밋입니다.

### 2. 개발 경로 설치 (agent-flow, 개발 중인 플러그인)

1. 설정 → 플러그인 화면을 **맨 아래까지 스크롤**해 제목이 **"개발"**인 영역을 찾습니다.
2. "개발 플러그인 폴더 경로" 칸에 `<이 저장소>/plugins/<id>`의 절대 경로를 넣고 **경로 추가**를 누릅니다.
3. Installed 목록에서 **검토 및 활성화**를 누릅니다.

자주 하는 실수입니다.

- **위쪽 "설치" 버튼에 로컬 경로를 넣으면 안 됩니다.** 그러면 그 순간의 파일이 `<Orca userData>/plugins/<publisher>.<id>/<해시>/`로 복사됩니다. 이후 코드 수정이 반영되지 않고, 자기 파일을 다시 쓰는 플러그인은 갱신되지 않습니다.
- 같은 플러그인이 이미 일반 설치되어 있으면 먼저 **제거**한 뒤 개발 경로를 추가합니다.
- 설치 방식은 `<Orca userData>/plugins/plugins.lock.json`의 `source.kind`로 확인합니다. 개발 경로가 아니라 `local-path`, `git`, `marketplace`이면 복사본입니다.

### 3. URL 직접 설치는 쓰지 않습니다

Orca의 git 설치는 저장소 **루트**의 `orca-plugin.json`만 읽고, 하위 폴더를 지정할 수 없습니다. 이 저장소 주소를 그대로 넣으면 실패합니다. 꼭 필요하면 태그를 지정합니다: `<저장소 주소>#<id>-v<version>`.

## 배포 규칙

- **새 버전 배포 = `orca-plugin.json`의 `version` 올리기 + master push**입니다. 워크플로(`.github/workflows/release-plugins.yml`)가 테스트 → 태그 생성 → 목록 갱신을 합니다.
- 버전을 그대로 두고 내용만 바꾸면 태그가 바뀌지 않습니다. 이미 만든 태그는 다시 쓰지 않습니다.
- 마켓 목록에서 빼야 하는 플러그인(개발 경로 전용 등)은 `marketplace.config.json`에 `"listed": false`와 `reason`을 적습니다.
- `orca-marketplace.json`은 손으로 고치지 않습니다. `npm run release:plan`으로 변경을 미리 보고, 실제 갱신은 CI에 맡깁니다.

## 개발 명령

```sh
npm test                 # 모든 플러그인과 배포 스크립트 테스트 (Node 22 이상)
npm run release:plan     # 만들 태그와 목록 변경 미리 보기
```

- 외부 의존성을 추가하지 않습니다. Node 내장 모듈과 `node:test`만 씁니다.
- 매니페스트를 바꾸면 Orca 소스의 `pluginManifestSchema`(`src/shared/plugins/plugin-manifest.ts`)와 맞는지 확인합니다.

## 공개 저장소 주의

- 커밋에 실제 에이전트 데이터를 넣지 않습니다. `plugins/agent-flow/panel/index.html`은 항상 `var DATA = null` 상태로 커밋합니다. 실제 데이터로 렌더링할 때는 `node scripts/render.mjs --live <저장소 밖 경로>`를 씁니다.
- 테스트 픽스처에 실제 경로, 사용자 이름, 세션 id, 회사 프로젝트 이름을 쓰지 않습니다.
- 워크플로에 `pull_request_target` 트리거를 추가하지 않습니다. 지금 워크플로는 `contents: write` 권한을 쓰므로, fork의 코드가 이 권한으로 실행되면 안 됩니다.
