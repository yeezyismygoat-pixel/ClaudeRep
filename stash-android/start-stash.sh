#!/data/data/com.termux/files/usr/bin/bash
# Stash 서버 실행.  옵션:
#   stash-start            -> 이 폰에서만 접속 (127.0.0.1:9999)
#   stash-start --lan      -> 같은 Wi-Fi의 PC/TV에서도 접속 허용 (0.0.0.0)
#   stash-start --fg       -> 백그라운드가 아닌 현재 터미널에서 실행 (로그 바로 보기)
#   STASH_PORT=8080 stash-start  -> 포트 변경
set -euo pipefail

STASH_HOME="$HOME/stash"
DATA="$STASH_HOME/data"
LOG="$STASH_HOME/stash.log"
PIDFILE="$STASH_HOME/stash.pid"
HOST="127.0.0.1"
PORT="${STASH_PORT:-9999}"
FG=0

for arg in "$@"; do
  case "$arg" in
    --lan) HOST="0.0.0.0" ;;
    --fg)  FG=1 ;;
    *) echo "알 수 없는 옵션: $arg" >&2; exit 1 ;;
  esac
done

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "이미 실행 중입니다 (PID $(cat "$PIDFILE")). http://localhost:$PORT"
  exit 0
fi

mkdir -p "$DATA"
cd "$DATA"   # config.yml, DB, 썸네일 등이 이 폴더에 저장됨

# Android에는 /etc/resolv.conf 가 없어서 Go로 만든 Stash가 DNS를 못 찾습니다
# (스크래퍼/메타데이터 검색 실패). proot로 Termux의 resolv.conf를 연결해 줍니다.
RESOLV="$PREFIX/etc/resolv.conf"
if [ ! -s "$RESOLV" ]; then
  printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > "$RESOLV"
fi

# Termux에는 $USER가 없어서 Stash가 "user: Current requires cgo or $USER" 로 종료됨
export USER="${USER:-$(id -un 2>/dev/null || echo termux)}"
export HOME="${HOME:-/data/data/com.termux/files/home}"
export SSL_CERT_FILE="$PREFIX/etc/tls/cert.pem"   # HTTPS 인증서
export PATH="$PREFIX/bin:$PATH"                    # ffmpeg/ffprobe 찾기
export TMPDIR="${TMPDIR:-$PREFIX/tmp}"

CMD=(proot -b "$RESOLV:/etc/resolv.conf" -b "$PREFIX/etc/tls:/etc/ssl/certs"
     "$STASH_HOME/bin/stash" --config "$DATA/config.yml"
     --host "$HOST" --port "$PORT" --nobrowser)

# 화면이 꺼져도 안드로이드가 프로세스를 재우지 않도록
command -v termux-wake-lock >/dev/null && termux-wake-lock || true

if [ "$FG" = 1 ]; then
  exec "${CMD[@]}"
fi

nohup "${CMD[@]}" >"$LOG" 2>&1 &
echo $! > "$PIDFILE"
sleep 2
if kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Stash 실행됨 → http://localhost:$PORT   (로그: $LOG)"
  if [ "$HOST" = "0.0.0.0" ]; then
    IP=$(ip -4 addr show wlan0 2>/dev/null | awk '/inet /{sub(/\/.*/,"",$2);print $2}')
    [ -n "${IP:-}" ] && echo "같은 Wi-Fi에서: http://$IP:$PORT  (설정에서 비밀번호를 꼭 지정하세요)"
  fi
else
  echo "실행 실패. 로그를 확인하세요:"; tail -n 30 "$LOG"; exit 1
fi
