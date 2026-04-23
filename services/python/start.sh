#!/bin/bash
set -e
cd "$(dirname "$0")"

# MediaPipe requires Python 3.12 or earlier
PYTHON=""
for candidate in python3.12 python3.11 python3.10; do
  if command -v "$candidate" &>/dev/null; then
    PYTHON="$candidate"
    break
  fi
done

if [ -z "$PYTHON" ]; then
  echo "ERROR: Python 3.12 not found."
  echo "Run: brew install python@3.12"
  exit 1
fi

echo "Using $($PYTHON --version)"

if [ ! -d "venv" ]; then
  $PYTHON -m venv venv
  echo "Created venv"
fi

source venv/bin/activate
pip install -r requirements.txt -q
echo ""
echo "Server starting on http://0.0.0.0:8000"
echo "From your phone, use: http://$(ipconfig getifaddr en0):8000"
echo ""
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
