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
