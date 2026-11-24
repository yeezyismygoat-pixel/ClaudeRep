#!/data/data/com.termux/files/usr/bin/bash
# VidVault 를 Termux 에 설치합니다.   사용법: bash install.sh
set -euo pipefail

if [ -z "${PREFIX:-}" ] || [ ! -d "$PREFIX" ]; then
  echo "Termux 가 아닌 환경입니다. python3 와 ffmpeg 를 설치한 뒤 'python3 server.py' 로 실행하세요." >&2
  exit 1
fi
APP_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> 패키지 업데이트 및 설치 (python, ffmpeg)"
# pkg 는 일부만 업그레이드된 상태에서 깨질 수 있어 apt 를 직접 사용
export DEBIAN_FRONTEND=noninteractive
OPTS=(-o Dpkg::Options::=--force-confold -o Dpkg::Options::=--force-confdef)
apt update
dpkg --configure -a || true
apt --fix-broken install -y "${OPTS[@]}" || true
apt full-upgrade -y "${OPTS[@]}"
apt install -y "${OPTS[@]}" python ffmpeg

if ! ffmpeg -version >/dev/null 2>&1; then
  echo "ffmpeg 가 실행되지 않습니다. 'apt full-upgrade' 를 다시 실행해 보세요." >&2
  exit 1
fi

if [ ! -d "$HOME/storage/shared" ]; then
  echo "==> 저장소 접근 권한 요청 (팝업에서 '허용'을 눌러 주세요)"
  termux-setup-storage || true
  sleep 4
fi

# 'vidvault' 명령 만들기
cat > "$PREFIX/bin/vidvault" <<LAUNCH
#!/data/data/com.termux/files/usr/bin/bash
# vidvault          -> 이 폰에서만 접속 (http://localhost:8899)
# vidvault --lan    -> 같은 Wi-Fi 의 PC/TV 에서도 접속
command -v termux-wake-lock >/dev/null && termux-wake-lock
if [ "\${1:-}" = "--lan" ]; then
  IP=\$(ip -4 addr show wlan0 2>/dev/null | awk '/inet /{sub(/\/.*/,"",\$2);print \$2}')
  [ -n "\$IP" ] && echo "다른 기기에서: http://\$IP:\${VIDVAULT_PORT:-8899}"
fi
exec python "$APP_DIR/server.py" "\$@"
LAUNCH
chmod +x "$PREFIX/bin/vidvault"

echo
echo "설치 완료!  'vidvault' 를 입력해 실행하고, 브라우저에서 http://localhost:8899 를 여세요."
