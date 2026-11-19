#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PAPERVIEW_PORT:-8787}"
BIND_HOST="127.0.0.1"
NO_BROWSER=0

while [ $# -gt 0 ]; do
  case "$1" in
    --port|-p)
      if [ -z "${2:-}" ]; then
        echo "[오류] --port 뒤에 포트 번호를 입력해주세요. (예: ./start.sh --port 9000)"
        exit 1
      fi
      PORT="$2"
      shift 2
      ;;
    --port=*)
      PORT="${1#*=}"
      shift
      ;;
    --host)
      if [ -z "${2:-}" ]; then
        echo "[오류] --host 뒤에 바인딩 주소를 입력해주세요."
        exit 1
      fi
      BIND_HOST="$2"
      shift 2
      ;;
    --host=*)
      BIND_HOST="${1#*=}"
      shift
      ;;
    --no-browser)
      NO_BROWSER=1
      shift
      ;;
    --help|-h)
      echo "사용법: ./start.sh [--port <포트번호>] [--host <바인딩주소>] [--no-browser]"
      echo "  --port, -p     실행 포트 지정 (기본값: 8787)"
      echo "  --host         바인딩 호스트 지정 (기본값: 127.0.0.1)"
      echo "  --no-browser   서버 시작 시 브라우저 자동 열기 생략"
      exit 0
      ;;
    *)
      echo "[오류] 알 수 없는 옵션입니다: $1 (--help 로 사용법 확인)"
      exit 1
      ;;
  esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "[오류] 유효하지 않은 포트 번호입니다: $PORT (1~65535)"
  exit 1
fi

echo "====================================================="
echo "  PaperView — Auto Setup & Local Server Launcher"
echo "====================================================="

# 1. Check Python 3.10+
PY_CMD=""
for cand in python3 python; do
  if command -v "$cand" >/dev/null 2>&1; then
    PY_CMD="$cand"
    break
  fi
done

if [ -z "$PY_CMD" ]; then
  echo "[오류] Python 3.10 이상이 필요합니다 (https://www.python.org/downloads/)."
  exit 1
fi

# 2. Auto-create backend/venv & install dependencies on first run
VENV_PY="$ROOT_DIR/backend/venv/bin/python"
DEPS_STAMP="$ROOT_DIR/backend/venv/.paperview_ready"

if [ ! -x "$VENV_PY" ]; then
  echo "[1/3] Python 가상환경(backend/venv) 생성 중..."
  "$PY_CMD" -m venv "$ROOT_DIR/backend/venv"
fi

if [ ! -f "$DEPS_STAMP" ]; then
  echo "[2/3] 백엔드 필수 패키지 설치 중..."
  "$VENV_PY" -m pip install --upgrade pip -q
  "$VENV_PY" -m pip install -r "$ROOT_DIR/backend/requirements.txt"
  "$VENV_PY" -m pip install "google-antigravity>=0.1.23" -q >/dev/null 2>&1 || true
  echo "ok" > "$DEPS_STAMP"
fi

# 3. Auto-install & build frontend if dist/index.html is missing
if [ ! -f "$ROOT_DIR/frontend/dist/index.html" ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "[오류] 프론트엔드 초기 빌드를 위해 Node.js(npm) 18 이상이 필요합니다 (https://nodejs.org/)."
    exit 1
  fi
  echo "[3/3] 프론트엔드 패키지 설치 및 빌드 중..."
  cd "$ROOT_DIR/frontend"
  if [ ! -d "node_modules" ]; then
    npm install
  fi
  npm run build
fi

BROWSER_HOST="$BIND_HOST"
if [ "$BROWSER_HOST" = "0.0.0.0" ]; then
  BROWSER_HOST="127.0.0.1"
fi
URL="http://${BROWSER_HOST}:$PORT"

echo ""
echo "====================================================="
echo "  PaperView 실행 준비 완료! -> $URL"
echo "  종료하려면 Ctrl + C 를 누르세요."
echo "====================================================="

if [ "$NO_BROWSER" -eq 0 ]; then
  (
    sleep 2
    if command -v open >/dev/null 2>&1; then
      open "$URL"
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$URL"
    fi
  ) >/dev/null 2>&1 &
fi

cd "$ROOT_DIR/backend"
export PYTHONIOENCODING="utf-8"
export PAPERVIEW_PORT="$PORT"
exec "$VENV_PY" -m uvicorn app.main:app --host "$BIND_HOST" --port "$PORT"
