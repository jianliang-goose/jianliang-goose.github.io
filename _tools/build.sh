#!/usr/bin/env bash
# Cloudflare 建置指令：bash _tools/build.sh，輸出資料夾：dist
# 只把網站用得到的檔案複製到 dist/，_tools、DEPLOY.md、.github 等不會被公開
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
mkdir dist
shopt -s nullglob
cp *.html *.js *.png *.jpg dist/
for d in css js images fonts data; do
  if [ -d "$d" ]; then cp -r "$d" dist/; fi
done

echo "dist/ ready: $(find dist -type f | wc -l) files"
