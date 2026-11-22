# VidShelf

휴대폰(Android/Termux)에서 돌아가는 가벼운 셀프호스팅 **영상 라이브러리**입니다.
폴더를 스캔해 썸네일을 만들고, 태그·출연자·별점·즐겨찾기·북마크로 영상을 정리하고,
브라우저에서 바로 재생합니다.

- **설치가 간단함**: Python 표준 라이브러리 + ffmpeg 만 사용 (pip 패키지, 컴파일 없음)
- **데이터**: `~/.vidshelf/` (SQLite DB + 썸네일). 영상 파일은 건드리지 않습니다.

## 기능

| | |
|---|---|
| 라이브러리 | 썸네일 그리드, 검색(제목·태그·출연자·경로), 정렬 10가지(무작위 포함), 즐겨찾기/안 본 영상 필터 |
| 미리보기 | 영상마다 8장면 자동 생성. PC에서는 썸네일 위에서 마우스를 좌우로 움직이면 장면이 바뀜 |
| 재생 | 원본 바로 재생(탐색 가능) + 브라우저가 못 여는 형식(AVI, WMV 등)은 ffmpeg 실시간 변환으로 자동 전환 |
| 정리 | 태그, 출연자, 별점(1~5), 즐겨찾기, 메모, 시간 북마크, 이어보기, 재생 횟수 |
| 관리 | 태그/출연자 이름 변경·병합·삭제, 사라진 파일 정리, 파일 삭제, 비밀번호 잠금 |

## 보안 폴더용 앱 (APK, `android/`)

보안 폴더에 설치하면 **보안 폴더의 영상만** 목록으로 만들고, 앱 안의 작은 웹 서버가
같은 VidShelf 화면을 보여 줍니다. 같은 Wi-Fi 의 다른 기기 브라우저에서도 볼 수 있습니다.

- 다운로드: https://github.com/yeezyismygoat-pixel/ClaudeRep/releases/download/vidshelf-apk/VidShelf.apk
- 이 폰: `http://localhost:8899` · 다른 기기: 앱 화면에 표시되는 `http://192.168.x.x:8899`
- 다른 기기 접속은 비밀번호를 정한 뒤에만 켤 수 있습니다.
- 기본 영상 폴더는 `DCIM/`, `Download/`. 브라우저 화면의 설정 탭에서 바꿀 수 있습니다.
- **MEGA 폴더 링크**: 설정 → MEGA 폴더 링크에 `https://mega.nz/folder/…#…` 를 넣으면 그 폴더의 영상이 라이브러리에 섞여 나오고, MEGA 탭에서 모든 파일을 볼 수 있습니다. 앱이 MEGA 에서 받아 복호화하면서 브라우저로 보내며, 재생 위치 이동도 됩니다. MEGA 무료 전송량 한도가 적용됩니다.
- `vidshelf/` 아래를 고쳐 이 브랜치에 push 하면 GitHub Actions 가 APK 를 다시 빌드해 같은 주소에 올립니다.

## 보안 폴더 / 브라우저 전용 버전 (`web/index.html`)

삼성 보안 폴더 안에서는 Termux가 동작하지 않으므로, 서버 없이 브라우저만으로 도는 버전을 따로 두었습니다.

- 보안 폴더 안의 Chrome 이나 삼성 인터넷으로 열고, **영상 고르기**로 보안 폴더의 영상을 선택합니다.
- 영상은 업로드되지 않습니다. 썸네일·태그·별점·북마크는 그 브라우저의 저장소(IndexedDB)에만 저장됩니다.
- 브라우저는 파일 접근을 기억하지 못하므로, 앱을 다시 열면 같은 영상을 한 번 더 골라야 재생됩니다 (정보는 유지).
- AVI·WMV 등 브라우저가 재생하지 못하는 형식은 재생되지 않습니다.
- **영상 관리 → 백업 복사**로 정보를 글자로 복사해 보관할 수 있습니다.

## Android(Termux) 설치

Termux(F-Droid 버전)에서 **한 줄씩** 입력하세요. 앞 명령이 끝나서 프롬프트가 다시 보이면 다음 줄로 넘어갑니다.

```bash
cd ~/ClaudeRep && git pull          # 이미 받아 둔 경우
cd ~/ClaudeRep/vidshelf
bash install.sh
vidshelf
```

처음 받는 경우에는 `git clone -b ccr-51e89e69-zcgdip https://github.com/yeezyismygoat-pixel/ClaudeRep.git` 을 먼저 실행하세요.

브라우저에서 **http://localhost:8899** → **설정** → 영상 폴더 추가(📁 폴더 찾아보기 또는 "빠르게 추가") →
**지금 스캔**. 스캔과 미리보기 생성은 백그라운드에서 진행되고 상단에 진행 상황이 표시됩니다.

```bash
vidshelf            # 이 폰에서만 접속
vidshelf --lan      # 같은 Wi-Fi 의 PC·태블릿·TV 에서도 접속 (설정에서 비밀번호 지정 권장)
VIDSHELF_PORT=9000 vidshelf   # 포트 변경
```
종료는 Termux 에서 `Ctrl+C`.

### 팁
- 화면이 꺼져도 동작하도록 `vidshelf` 가 wake lock 을 겁니다. 그래도 꺼지면 Android 설정 → 앱 → Termux → 배터리 → **제한 없음**.
- Chrome 메뉴 → **홈 화면에 추가** 하면 앱처럼 열 수 있습니다.
- 백업: `cp -r ~/.vidshelf ~/storage/shared/vidshelf-backup`

## PC(Linux/macOS/Windows)에서 실행

Python 3.9+ 와 ffmpeg 가 있으면 됩니다.
```bash
python3 server.py           # 또는 --lan, --port 9000
```
