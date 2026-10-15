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

# プロファイルを小さく保つ。プロファイルはわざとこのフォルダの中に置いている（フォルダごとコピーすれば、設定と保存した
# メディアも一緒に移る）ので、このアプリで使わない部品（拡張機能・端末内のモデル・読み上げエンジンなど。合わせて約 200MB）を
# Chrome が落とさないようにする（端末内のモデル 40MB を止めるのは OptimizationHints。Chrome 154 で実測）。
# 前の版の起動スクリプトで落ちていた部品は消す（要るものは Chrome が作り直す）。この VJ がまだ開いている間
# （Chrome がプロファイルに SingletonLock を置いている間）は触らない。
if [ -d "$PROFILE" ] && [ ! -e "$PROFILE/SingletonLock" ] && [ ! -L "$PROFILE/SingletonLock" ]; then
  for D in component_crx_cache extensions_crx_cache optimization_guide_model_store OptimizationGuideModelsManifest OnDeviceHeadSuggestModel WasmTtsEngine "Default/Extensions"; do
    rm -rf "${PROFILE:?}/$D"
  done
fi

for APP in "Google Chrome" "Microsoft Edge" "Chromium"; do
  if open -Ra "$APP" >/dev/null 2>&1; then
    open -na "$APP" --args \
      --user-data-dir="$PROFILE" \
      --no-first-run --no-default-browser-check \
      --disable-background-timer-throttling \
      --disable-renderer-backgrounding \
      --disable-backgrounding-occluded-windows \
      --disable-extensions --disable-component-update --disable-default-apps \
      --disk-cache-size=33554432 --media-cache-size=33554432 \
      --disable-features=Translate,OptimizationHints,OptimizationHintsFetching,OptimizationTargetPrediction,OptimizationGuideModelDownloading \
      --autoplay-policy=no-user-gesture-required \
      --app="$URL"
    exit 0
  fi
done

osascript -e 'display alert "Chrome が見つかりません" message "Google Chrome をインストールするか、momosai-vj.html を Chrome にドラッグして開いてください。"'
exit 1
