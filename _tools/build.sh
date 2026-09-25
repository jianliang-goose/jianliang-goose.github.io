#!/usr/bin/env bash
# Cloudflare Pages 建置指令：bash _tools/build.sh，輸出資料夾：dist
# 只把網站用得到的檔案複製到 dist/，_tools、DEPLOY.md、.github 等不會被公開
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
mkdir dist
cp *.html *.js *.png *.jpg dist/
cp -r css js images fonts data dist/

echo "dist/ ready: $(find dist -type f | wc -l) files"
