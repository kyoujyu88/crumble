#!/usr/bin/env bash
# Crumble — 環境セットアップスクリプト
set -e

echo "=== Crumble セットアップ ==="

# Blender インストール
if ! command -v blender &>/dev/null; then
    echo "[1/3] Blender をインストール中..."
    apt-get update -qq
    apt-get install -y blender
    echo "      Blender $(blender --version 2>&1 | head -1) インストール完了"
else
    echo "[1/3] Blender は既にインストール済み: $(blender --version 2>&1 | head -1)"
fi

# Blender 内蔵 Python に numpy をインストール（glTF2 エクスポーターが必要）
BLENDER_PYTHON=$(blender --background --python-expr "import sys; print(sys.executable)" 2>/dev/null | grep -v "^Blender" | tail -1)
if [ -n "$BLENDER_PYTHON" ]; then
    echo "[2/4] Blender Python ($BLENDER_PYTHON) に numpy をインストール..."
    "$BLENDER_PYTHON" -m pip install numpy --break-system-packages -q 2>/dev/null || \
    "$BLENDER_PYTHON" -m pip install numpy -q 2>/dev/null || true
else
    echo "[2/4] Blender Python が見つからない（スキップ）"
fi

# Python 依存関係
echo "[3/4] Python 依存関係をインストール中..."
pip3 install -r requirements.txt -q

# デスクトップ GUI 用 tkinter（Linux のみ。Windows/macOS は標準同梱）
if [ "$(uname)" = "Linux" ] && ! python3 -c "import tkinter" &>/dev/null; then
    echo "      GUI 用に python3-tk をインストール..."
    apt-get install -y python3-tk 2>/dev/null || \
    echo "      （python3-tk のインストールに失敗。gui.py を使わなければ無視可）"
fi

# npm 依存関係
echo "[4/4] Viewer の npm パッケージをインストール中..."
cd viewer && npm install --silent
cd ..

echo ""
echo "=== セットアップ完了 ==="
echo ""
echo "使い方:"
echo "  GLB生成:    python pipeline.py --type barrel --pieces 20 --seed 1 --out output/barrel.glb"
echo "  GUI:        python gui.py"
echo "  ビューア:   cd viewer && npm run dev"
