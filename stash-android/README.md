# Stash on Android (Termux)

[Stash](https://github.com/stashapp/stash)는 영상 파일을 스캔해서 썸네일·미리보기·태그·출연자·
스튜디오별로 정리해 주는 셀프호스팅 영상 라이브러리입니다. Stash는 Go로 만든 **정적 링크
바이너리**를 ARM용으로도 배포하기 때문에, 루팅 없이 **Termux** 안에서 그대로 돌릴 수 있습니다.
이 폴더의 스크립트는 그 과정(설치, DNS/인증서 문제 우회, 백그라운드 실행)을 자동화합니다.

```
┌──────────── Android 폰 ────────────┐
│ Termux                              │
│  └─ stash (arm64 바이너리) :9999    │◀── Chrome에서 http://localhost:9999
│       ├─ ffmpeg (썸네일/트랜스코딩) │◀── (--lan) 같은 Wi-Fi의 PC·TV
│       └─ /sdcard/Movies, DCIM ...   │
└─────────────────────────────────────┘
```

## 1. 준비

1. **Termux를 F-Droid 또는 GitHub에서 설치**하세요. (Play 스토어 버전은 오래돼서 `pkg`가 동작하지 않습니다)
   - https://f-droid.org/packages/com.termux/
2. Termux를 열고 이 저장소를 받습니다.
   ```bash
   pkg install -y git
   git clone -b ccr-51e89e69-zcgdip https://github.com/yeezyismygoat-pixel/ClaudeRep.git
   cd ClaudeRep/stash-android
   ```

## 2. 설치

```bash
bash install.sh
```
- ffmpeg, proot, 인증서를 설치하고, 폰 CPU에 맞는 Stash 최신 버전을 `~/stash/bin/stash`에 받습니다.
- 저장소 권한 팝업이 뜨면 **허용**을 누르세요 (`~/storage/shared` = 내부 저장소).
- 특정 버전: `STASH_VERSION=v0.32.0 bash install.sh` / 업데이트: `bash install.sh` 다시 실행.

## 3. 실행

```bash
stash-start          # 폰에서만 접속
stash-start --lan    # 같은 Wi-Fi의 PC/TV에서도 접속 (http://폰IP:9999)
stash-start --fg     # 로그를 화면에 띄운 채 실행 (문제 확인용)
stash-stop           # 종료
```

폰 브라우저에서 **http://localhost:9999** 를 열면 첫 실행 설정 화면이 나옵니다.

1. **Configuration 위치**: "In the current working directory"를 선택 (`~/stash/data`에 저장됨)
2. **라이브러리 경로** 추가 — Termux 경로로 입력:
   - `/data/data/com.termux/files/home/storage/shared/Movies`
   - `/data/data/com.termux/files/home/storage/shared/DCIM`
   - `/data/data/com.termux/files/home/storage/shared/Download`
   - SD카드: `/data/data/com.termux/files/home/storage/external-1` (기기에 따라 다름)
3. 나머지(generated, cache, metadata 폴더)는 기본값 그대로 두면 됩니다.
4. 완료 후 **Tasks → Scan** 으로 영상 스캔, 이어서 **Generate**로 썸네일/미리보기 생성.

## 4. 폰에서 쓸 때 권장 설정

폰은 CPU·배터리·저장공간이 한정적이라 아래처럼 가볍게 쓰는 것을 추천합니다.

| 위치 | 권장 |
|---|---|
| Settings → Tasks → Generate | **Previews / Sprites / Phashes / Markers는 끄고** 시작 (용량·시간을 많이 씀). Covers만 켜기 |
| Settings → System → Transcoding | 최대 스트리밍 화질 `720p`, Parallel tasks `1` |
| Settings → System → Parallel scan/generate | `1` ~ `2` |
| Settings → Security | `--lan`으로 쓸 땐 **사용자명/비밀번호 반드시 설정** |

H.264/H.265 MP4는 대부분 브라우저에서 바로 재생되어 트랜스코딩이 필요 없습니다.
MKV/AVI 등은 실시간 트랜스코딩이 일어나서 발열·버벅임이 생길 수 있습니다.

## 5. 계속 켜 두기 / 부팅 시 자동 실행

- `stash-start`는 `termux-wake-lock`을 걸어서 화면이 꺼져도 동작하게 합니다.
- 그래도 꺼진다면: 안드로이드 설정 → 앱 → Termux → 배터리 → **제한 없음(최적화 안 함)**.
- 부팅 시 자동 실행: [Termux:Boot](https://f-droid.org/packages/com.termux.boot/) 설치 후 한 번 열고,
  ```bash
  mkdir -p ~/.termux/boot
  printf '#!/data/data/com.termux/files/usr/bin/bash\nstash-start\n' > ~/.termux/boot/stash
  chmod +x ~/.termux/boot/stash
  ```

## 6. 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| 스크래퍼·StashDB 검색이 안 됨 (`dial udp [::1]:53` 등) | 안드로이드엔 `/etc/resolv.conf`가 없음. `stash-start`가 proot로 연결해 주므로 Stash 바이너리를 직접 실행하지 말고 `stash-start`를 쓰세요 |
| `ffmpeg not found` | `pkg install ffmpeg` 후 재시작 |
| 폴더가 비어 보임 / permission denied | `termux-setup-storage` 다시 실행, 안드로이드 설정에서 Termux 파일 권한 허용 |
| 새 파일이 자동으로 안 잡힘 | `/sdcard`는 파일 변경 감지가 잘 안 됩니다. Tasks → Scan을 수동으로 실행 |
| 실행 직후 종료 | `stash-start --fg`로 로그 확인, 또는 `tail ~/stash/stash.log` |

데이터는 전부 `~/stash/data`에 있습니다(DB, 썸네일, 설정). Termux를 삭제하면 같이 지워지니
백업하려면 `cp -r ~/stash/data ~/storage/shared/stash-backup`.
