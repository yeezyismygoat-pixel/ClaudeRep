#!/data/data/com.termux/files/usr/bin/bash
# Stash (영상 라이브러리 관리 프로그램)를 Termux에 설치합니다.
# 사용법: bash install.sh
set -euo pipefail

STASH_HOME="$HOME/stash"
BIN_DIR="$STASH_HOME/bin"
STASH_VERSION="${STASH_VERSION:-latest}"   # 특정 버전: STASH_VERSION=v0.32.0 bash install.sh

if [ -z "${PREFIX:-}" ] || [ ! -d "$PREFIX" ]; then
  echo "이 스크립트는 Android의 Termux 안에서 실행해야 합니다." >&2
  exit 1
fi

# 1) CPU 아키텍처에 맞는 Stash 바이너리 선택
case "$(uname -m)" in
  aarch64|arm64) ASSET="stash-linux-arm64v8" ;;
  armv7l|armv8l) ASSET="stash-linux-arm32v7" ;;
  armv6l)        ASSET="stash-linux-arm32v6" ;;
  x86_64)        ASSET="stash-linux" ;;
  *) echo "지원하지 않는 아키텍처: $(uname -m)" >&2; exit 1 ;;
esac

# 2) 필요한 패키지: ffmpeg(썸네일/미리보기/트랜스코딩), proot(DNS 설정용), CA 인증서
echo "==> 패키지 설치 (ffmpeg, proot, ca-certificates, curl)"
# 오래된 패키지가 남아 있으면 ffmpeg가 "CANNOT LINK EXECUTABLE" 오류로 실패하므로 전체 업그레이드
export DEBIAN_FRONTEND=noninteractive
# (pkg 명령은 curl을 쓰므로 일부만 업그레이드된 상태에서 깨질 수 있어 apt를 직접 사용)
DPKG_OPTS=(-o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef)
apt update
dpkg --configure -a || true
apt --fix-broken install -y "${DPKG_OPTS[@]}" || true
apt full-upgrade -y "${DPKG_OPTS[@]}"
apt install -y "${DPKG_OPTS[@]}" ffmpeg proot ca-certificates curl

# 3) 휴대폰 저장소(/sdcard) 접근 권한 요청 — 팝업이 뜨면 '허용'
if [ ! -d "$HOME/storage/shared" ]; then
  echo "==> 저장소 접근 권한 요청 (팝업에서 허용을 눌러 주세요)"
  termux-setup-storage || true
  sleep 3
fi

# 4) Stash 다운로드
mkdir -p "$BIN_DIR" "$STASH_HOME/data"
if [ "$STASH_VERSION" = "latest" ]; then
  URL="https://github.com/stashapp/stash/releases/latest/download/$ASSET"
else
  URL="https://github.com/stashapp/stash/releases/download/$STASH_VERSION/$ASSET"
fi
echo "==> Stash 다운로드: $URL"
curl -fL --progress-bar -o "$BIN_DIR/stash.new" "$URL"
chmod +x "$BIN_DIR/stash.new"
mv -f "$BIN_DIR/stash.new" "$BIN_DIR/stash"

# 5) 실행 스크립트 설치
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
install -m 755 "$SCRIPT_DIR/start-stash.sh" "$PREFIX/bin/stash-start"
install -m 755 "$SCRIPT_DIR/stop-stash.sh"  "$PREFIX/bin/stash-stop"

echo
echo "설치 완료!  'stash-start' 로 실행한 뒤 브라우저에서 http://localhost:9999 를 여세요."
echo "휴대폰 영상 폴더 예: $HOME/storage/shared/Movies, $HOME/storage/shared/DCIM"
