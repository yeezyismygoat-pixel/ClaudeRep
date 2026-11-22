#!/data/data/com.termux/files/usr/bin/bash
PIDFILE="$HOME/stash/stash.pid"
if [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "Stash 종료됨"
else
  pkill -f "$HOME/stash/bin/stash" && echo "Stash 종료됨" || echo "실행 중인 Stash가 없습니다"
fi
rm -f "$PIDFILE"
command -v termux-wake-unlock >/dev/null && termux-wake-unlock || true
