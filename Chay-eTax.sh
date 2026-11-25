#!/bin/sh
# Chạy eTax Manager (macOS / Linux). Cần đã cài Node.js: https://nodejs.org
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Không tìm thấy Node.js. Hãy cài bản LTS tại https://nodejs.org rồi chạy lại."
  printf "Nhấn Enter để đóng…"; read _; exit 1
fi
node server/server.mjs --open
