#!/bin/sh
# deploy.sh tipa    -> copy dist/HomeView.tipa to the iPad's Files (On My iPad) for TrollStore
# deploy.sh config  -> write config.json (+ HA token from ~/.config/homeview/ha_token) into the app's Documents
# deploy.sh log [n] -> last n lines of the app's log
set -eu
cd "$(dirname "$0")/.."
IPAD="${IPAD:?set IPAD=mobile@<iPad IP>}"
BUNDLE=com.robin.homeview
# 文件 App「我的 iPad」的实际目录，每台设备的 AppGroup UUID 不同：
#   ssh $IPAD 'ls -d /var/mobile/Containers/Shared/AppGroup/*/File\ Provider\ Storage'
FILES="${FILES:-}"

container() {
  ssh -o BatchMode=yes "$IPAD" "for d in /var/mobile/Containers/Data/Application/*; do grep -aq '$BUNDLE' \"\$d/.com.apple.mobile_container_manager.metadata.plist\" 2>/dev/null && echo \"\$d\"; done" | head -1
}

case "${1:-}" in
  tipa)
    [ -n "$FILES" ] || { echo "set FILES=<.../File Provider Storage> (see the comment at the top)"; exit 2; }
    scp -q dist/HomeView.tipa "$IPAD:$FILES/HomeView.tipa"
    echo "copied to 文件 → 我的 iPad → HomeView.tipa"
    ;;
  config)
    C=$(container)
    [ -n "$C" ] || { echo "HomeView is not installed yet"; exit 1; }
    TMP=$(mktemp)
    chmod 600 "$TMP"
    python3 - "$TMP" <<'EOF'
import json, os, sys
cfg = json.load(open("config.json", encoding="utf-8"))
tok = os.path.expanduser("~/.config/homeview/ha_token")
cfg["token"] = open(tok).read().strip()
json.dump(cfg, open(sys.argv[1], "w"), ensure_ascii=False)
EOF
    scp -q "$TMP" "$IPAD:$C/Documents/config.json"
    rm -f "$TMP"
    ssh -o BatchMode=yes "$IPAD" "chmod 600 '$C/Documents/config.json'"
    echo "config written to $C/Documents"
    ;;
  web)
    # The page from web/ into the app's Documents/web; the shell reloads within 3 s.
    C=$(container)
    [ -n "$C" ] || { echo "HomeView is not installed yet"; exit 1; }
    V=$(date +%s)
    TMP=$(mktemp -d)
    cp -R web/index.html web/css web/js "$TMP/"
    sed -i '' "s/\.js\"/.js?v=$V\"/g; s/\.css\"/.css?v=$V\"/g" "$TMP/index.html"
    echo "$V" > "$TMP/.stamp.next"
    ssh -o BatchMode=yes "$IPAD" "rm -rf '$C/Documents/web.next' && mkdir -p '$C/Documents/web.next'"
    scp -q -r "$TMP"/index.html "$TMP"/css "$TMP"/js "$IPAD:$C/Documents/web.next/"
    ssh -o BatchMode=yes "$IPAD" "rm -rf '$C/Documents/web' && mv '$C/Documents/web.next' '$C/Documents/web' && echo $V > '$C/Documents/web/.stamp'"
    rm -rf "$TMP"
    echo "web $V deployed"
    ;;
  log)
    C=$(container)
    ssh -o BatchMode=yes "$IPAD" "tail -n ${2:-30} '$C/Documents/log.jsonl'"
    ;;
  *)
    echo "usage: $0 tipa|web|config|log [n]"; exit 2 ;;
esac
