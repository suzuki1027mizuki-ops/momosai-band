#!/bin/bash
# MOMOSAI VJ launcher for macOS.
# momosai-vj.html を Chrome（なければ Edge / Chromium）の専用プロファイル・アプリウィンドウで開く。
# 初回は「右クリック → 開く」で起動してください（Gatekeeper の確認が出るため）。
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
PAGE="$HERE/momosai-vj.html"
PROFILE="$HERE/.vj-profile"

if [ ! -f "$PAGE" ]; then
  osascript -e 'display alert "momosai-vj.html が見つかりません" message "このファイルと同じフォルダに置いてください。"'
  exit 1
fi

URL="file://${PAGE// /%20}"

for APP in "Google Chrome" "Microsoft Edge" "Chromium"; do
  if open -Ra "$APP" >/dev/null 2>&1; then
    open -na "$APP" --args \
      --user-data-dir="$PROFILE" \
      --no-first-run --no-default-browser-check \
      --disable-background-timer-throttling \
      --disable-renderer-backgrounding \
      --disable-backgrounding-occluded-windows \
      --autoplay-policy=no-user-gesture-required \
      --app="$URL"
    exit 0
  fi
done

osascript -e 'display alert "Chrome が見つかりません" message "Google Chrome をインストールするか、momosai-vj.html を Chrome にドラッグして開いてください。"'
exit 1
