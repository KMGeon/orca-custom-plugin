# orca-custom-plugin

[Orca](https://github.com/stablyai/orca)에서 쓰는 개인 플러그인 모음입니다. 저장소 하나에서 여러 플러그인을 개발하고, Orca 마켓플레이스로 배포합니다.

| 플러그인 | 하는 일 | 설치 방법 |
|---|---|---|
| [agent-flow](plugins/agent-flow) | 에이전트끼리 누가 누구에게 무엇을 시켰는지 흐름 그래프로 보여 줍니다 | 개발 경로만 |

## 설치

### 마켓플레이스 (권장)

1. Orca → 설정 → 플러그인 → 마켓플레이스 추가에 아래 주소를 넣습니다. 공개 저장소라서 HTTPS 주소로 바로 설치됩니다.
   ```
   https://github.com/KMGeon/orca-custom-plugin.git
   ```
2. 목록에서 플러그인을 골라 설치하고, 검토 및 활성화를 누릅니다.

### 개발 경로 (agent-flow, 또는 개발 중인 플러그인)

설정 → 플러그인 맨 아래 **"개발"** 영역의 "개발 플러그인 폴더 경로"에 `plugins/<id>` 폴더 경로를 넣고 **경로 추가**를 누릅니다. 위쪽 "설치" 버튼으로 넣으면 복사본이 설치되어 파일 변경이 반영되지 않습니다.

## 배포 구조

Orca는 git ref의 **루트**에 있는 `orca-plugin.json`만 읽습니다. 그래서 플러그인 폴더마다 그 폴더를 루트로 하는 태그를 만듭니다.

```
master                     plugins/<id>/ 에서 개발
태그 <id>-v<version>        plugins/<id>/ 만 잘라낸 커밋 (자동 생성)
orca-marketplace.json      태그 목록 (자동 생성)
marketplace.config.json    마켓플레이스 이름, 저장소 주소, 플러그인별 카테고리와 목록 제외 설정
```

master에 push하면 [release-plugins](.github/workflows/release-plugins.yml) 워크플로가 이렇게 동작합니다.

1. `npm test`를 실행합니다.
2. 새 `version`의 플러그인마다 `<id>-v<version>` 태그를 만들어 push합니다.
3. `orca-marketplace.json`이 바뀌었으면 커밋합니다.

**새 버전을 배포하려면 `orca-plugin.json`의 `version`을 올리세요.** 버전을 그대로 두고 내용만 바꾸면 기존 태그가 유지되고, 워크플로 로그에 경고가 남습니다.

로컬에서 미리 보기:

```sh
npm run release:plan   # 만들 태그와 목록 변경만 출력
npm test
```

## 새 플러그인 추가

1. `plugins/<id>/orca-plugin.json`을 만듭니다. `id`는 폴더 이름과 같아야 하고, `publisher`는 `kmgeon`으로 둡니다.
2. 필요한 권한만 `capabilities`에 넣습니다. 권한이 바뀌면 Orca가 다시 동의를 받습니다.
3. 테스트는 `plugins/<id>/test/*.test.mjs`에 둡니다.
4. 카테고리를 붙이거나 목록에서 빼려면 `marketplace.config.json`의 `plugins.<id>`에 적습니다.
5. 위 표에 한 줄을 추가하고 master에 push합니다.

플러그인 API의 제약은 [AGENTS.md](AGENTS.md)에 정리했습니다. 만들기 전에 먼저 읽어 주세요.
