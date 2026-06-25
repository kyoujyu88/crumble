#!/usr/bin/env python3
"""
Crumble — プロンプト解析層（フェーズ4）

自然言語の指示を pipeline.py のパラメータ辞書に変換する。

2 層構成:
  A. ルールベース（キーワード辞書 + 正規表現）… 高速・無料・オフライン・決定論的
  B. LLM フォールバック（Claude API, 任意）   … 種別が判定できない／曖昧な時だけ

返り値は「判定できたキーだけ」を含む部分辞書。
pipeline.py 側で デフォルト < プロンプト解析 < 明示引数 の優先順位でマージする。

使い方:
    from prompt_parser import parse
    params = parse("重い木製の樽を30破片で派手に割れるように")
    # -> {"type": "barrel", "pieces": 30, "weight": 50.0, "fragility": 0.9, ...}

単体実行（デバッグ）:
    python prompt_parser.py "軽くて脆いガラスを20破片で"
"""
import os
import re
import sys

# ---- 既定値（pipeline.py と一致させる） ----
DEFAULTS = {
    "pieces": 20,
    "seed": 1,
    "size": 1.0,
    "weight": 10.0,
    "fragility": 0.5,
    "friction": 0.5,
    "restitution": 0.3,
    "impact_x": 0.0,
    "impact_y": 0.0,
}

# ---- 種別キーワード ----
TYPE_KEYWORDS = {
    "barrel": ["樽", "たる", "タル", "バレル", "barrel", "ドラム缶", "木箱", "酒樽"],
    "rock":   ["岩", "石", "ロック", "rock", "岩石", "ボルダー", "岩塊", "石塊", "塊", "かたまり"],
    "glass":  ["ガラス", "硝子", "ガラス板", "窓ガラス", "窓", "glass", "板ガラス"],
}

# ---- 形容詞 → 連続パラメータ（キーワード: 目標値） ----
WEIGHT_WORDS = {
    "超重": 95, "激重": 95, "超重い": 95, "ずっしり": 70, "重厚": 75,
    "重い": 50, "重たい": 50, "おもい": 50, "重": 45,
    "やや重": 25,
    "軽量": 3, "超軽": 1, "羽": 1, "ふわふわ": 1, "軽い": 3, "かるい": 3, "軽": 4,
}
FRAGILITY_WORDS = {
    "木っ端微塵": 1.0, "木っ端みじん": 1.0, "粉々": 1.0, "こなごな": 1.0,
    "派手": 0.9, "盛大": 0.9,
    "脆い": 0.95, "もろい": 0.95, "割れやすい": 0.85, "壊れやすい": 0.85,
    "頑丈": 0.15, "丈夫": 0.15, "壊れにくい": 0.12, "割れにくい": 0.12, "硬い": 0.2, "固い": 0.2,
}
FRICTION_WORDS = {
    "ツルツル": 0.05, "つるつる": 0.05, "滑らか": 0.1, "滑る": 0.1, "氷のよう": 0.05,
    "ザラザラ": 0.9, "ざらざら": 0.9, "ゴツゴツ": 0.85, "ざらつ": 0.8, "粗い": 0.8,
}
RESTITUTION_WORDS = {
    "よく跳ねる": 0.85, "よく弾む": 0.85, "弾む": 0.7, "跳ねる": 0.7, "バウンド": 0.7,
    "ゴムのよう": 0.85, "跳ねない": 0.05, "弾まない": 0.05, "衝撃吸収": 0.1,
}

# ---- 素材ヒント（形容詞より優先度低、見つかったキーだけ適用） ----
MATERIAL_HINTS = {
    "木製": {"weight": 8.0, "fragility": 0.5},
    "木": {"weight": 8.0, "fragility": 0.5},
    "鉄": {"weight": 80.0, "fragility": 0.15, "restitution": 0.2},
    "鋼": {"weight": 85.0, "fragility": 0.12},
    "金属": {"weight": 70.0, "fragility": 0.2},
    "石材": {"weight": 60.0, "fragility": 0.3},
    "コンクリート": {"weight": 75.0, "fragility": 0.35},
    "氷": {"weight": 15.0, "fragility": 0.9, "friction": 0.05},
    "陶器": {"weight": 12.0, "fragility": 0.9},
    "陶": {"weight": 12.0, "fragility": 0.9},
    "プラスチック": {"weight": 4.0, "fragility": 0.4},
    "ゴム": {"weight": 6.0, "fragility": 0.3, "restitution": 0.85},
}


def parse(text: str, use_llm="auto", model: str = None) -> dict:
    """
    自然言語をパラメータ部分辞書に変換する。

    use_llm:
        "auto" … ルールで種別が取れなければ LLM を試す（既定）
        True   … 常に LLM を併用
        False  … ルールベースのみ
    """
    rule = parse_rules(text)

    need_llm = (use_llm is True) or (use_llm == "auto" and "type" not in rule)
    if need_llm:
        llm = parse_llm(text, model=model)
        if llm:
            # ルールベースの確定値（キーワード・数値）を優先して上書き
            return {**llm, **rule}

    return rule


# ============================================================
#  A. ルールベース
# ============================================================
def parse_rules(text: str) -> dict:
    if not text or not text.strip():
        return {}
    t = text.strip()
    low = t.lower()
    out = {}

    # ---- 素材ヒント（最初に適用＝最低優先） ----
    for word, hints in MATERIAL_HINTS.items():
        if word in t:
            for k, v in hints.items():
                out.setdefault(k, v)
            break  # 最初に当たった素材のみ

    # ---- 種別 ----
    t_type = _match_type(t, low)
    if t_type:
        out["type"] = t_type

    # ---- 形容詞 → 連続パラメータ（素材ヒントを上書き） ----
    w = _pick_value(t, WEIGHT_WORDS, DEFAULTS["weight"])
    if w is not None:
        out["weight"] = w
    f = _pick_value(t, FRAGILITY_WORDS, DEFAULTS["fragility"])
    if f is not None:
        out["fragility"] = f
    fr = _pick_value(t, FRICTION_WORDS, DEFAULTS["friction"])
    if fr is not None:
        out["friction"] = fr
    rs = _pick_value(t, RESTITUTION_WORDS, DEFAULTS["restitution"])
    if rs is not None:
        out["restitution"] = rs

    # ---- 数値の直接抽出（最優先） ----
    _extract_numbers(t, low, out)

    # ---- 粉々系は破片数も増やす（明示数値が無い時だけ） ----
    if "pieces" not in out and out.get("fragility", 0) >= 1.0:
        out["pieces"] = 40

    return out


def _match_type(t: str, low: str):
    """最初に出現した種別キーワードを採用（複数該当時は出現位置が早いもの）"""
    best_pos = None
    best_type = None
    for typ, words in TYPE_KEYWORDS.items():
        for w in words:
            idx = low.find(w.lower())
            if idx != -1 and (best_pos is None or idx < best_pos):
                best_pos = idx
                best_type = typ
    return best_type


def _pick_value(t: str, table: dict, default: float):
    """
    table のキーワードのうち本文に含まれるものを探し、
    既定値から最も離れた（=最も強い指示の）値を返す。該当なしは None。
    長いキーワードを優先してマッチ（部分一致の誤爆を抑える）。
    """
    found = []
    for word in sorted(table.keys(), key=len, reverse=True):
        if word in t:
            found.append(table[word])
    if not found:
        return None
    return max(found, key=lambda v: abs(v - default))


def _extract_numbers(t: str, low: str, out: dict):
    # 破片数: "30破片" "20個" "25ピース" "pieces 25" "30分割"
    m = re.search(r'(\d+)\s*(?:個|破片|片|ピース|分割|pieces?|pcs?)', low)
    if m:
        out["pieces"] = _clamp_int(int(m.group(1)), 2, 999)
    else:
        m2 = re.search(r'pieces?\s*[:：=]?\s*(\d+)', low)
        if m2:
            out["pieces"] = _clamp_int(int(m2.group(1)), 2, 999)

    # シード: "シード42" "seed 7" "種7"
    m = re.search(r'(?:シード|seed|種)\s*[:：=]?\s*(\d+)', low)
    if m:
        out["seed"] = int(m.group(1))

    # サイズ: "2倍" "1.5倍" "サイズ2" "size 0.5"
    m = re.search(r'(\d+(?:\.\d+)?)\s*倍', t)
    if m:
        out["size"] = _clamp_float(float(m.group(1)), 0.1, 10.0)
    else:
        m = re.search(r'(?:サイズ|size)\s*[:：=]?\s*(\d+(?:\.\d+)?)', low)
        if m:
            out["size"] = _clamp_float(float(m.group(1)), 0.1, 10.0)
        elif any(k in t for k in ["巨大", "でかい", "大きい", "大型"]):
            out["size"] = 2.0
        elif any(k in t for k in ["小さい", "ミニ", "小型", "ちいさい"]):
            out["size"] = 0.5


def _clamp_int(v, lo, hi):
    return max(lo, min(hi, v))


def _clamp_float(v, lo, hi):
    return max(lo, min(hi, v))


# ============================================================
#  B. LLM フォールバック（任意）
# ============================================================
_LLM_TOOL = {
    "name": "set_crumble_params",
    "description": "破壊可能3Dオブジェクトの生成パラメータを設定する",
    "input_schema": {
        "type": "object",
        "properties": {
            "type": {"type": "string", "enum": ["barrel", "rock", "glass"],
                     "description": "オブジェクト種別。樽=barrel, 岩=rock, ガラス=glass"},
            "pieces": {"type": "integer", "minimum": 2, "maximum": 999,
                       "description": "破片数。多いほど細かく割れる"},
            "size": {"type": "number", "minimum": 0.1, "maximum": 10.0,
                     "description": "スケール倍率。1.0が標準"},
            "weight": {"type": "number", "minimum": 0.1, "maximum": 100.0,
                       "description": "総質量kg。重いほどドスンと落ちる"},
            "fragility": {"type": "number", "minimum": 0.0, "maximum": 1.0,
                          "description": "壊れやすさ。1.0で派手に飛び散る"},
            "friction": {"type": "number", "minimum": 0.0, "maximum": 1.0,
                         "description": "摩擦係数"},
            "restitution": {"type": "number", "minimum": 0.0, "maximum": 1.0,
                            "description": "反発係数。大きいほど跳ねる"},
        },
        "required": ["type"],
    },
}

# 解析用モデル（安価な Haiku を既定に。環境変数で上書き可）
_DEFAULT_LLM_MODEL = os.environ.get("CRUMBLE_LLM_MODEL", "claude-haiku-4-5-20251001")


def llm_available() -> bool:
    """LLM フォールバックが使える状態かを返す。"""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return False
    try:
        import anthropic  # noqa: F401
        return True
    except ImportError:
        return False


def parse_llm(text: str, model: str = None) -> dict:
    """Claude API で構造化パラメータを得る。失敗時は {} を返す。"""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("[prompt_parser] LLM スキップ: ANTHROPIC_API_KEY が未設定", file=sys.stderr)
        return {}
    try:
        import anthropic
    except ImportError:
        print("[prompt_parser] LLM スキップ: anthropic パッケージが未インストール "
              "(pip install anthropic)", file=sys.stderr)
        return {}

    try:
        client = anthropic.Anthropic()
        msg = client.messages.create(
            model=model or _DEFAULT_LLM_MODEL,
            max_tokens=512,
            tools=[_LLM_TOOL],
            tool_choice={"type": "tool", "name": "set_crumble_params"},
            messages=[{
                "role": "user",
                "content": (
                    "次の指示から破壊可能3Dオブジェクトの生成パラメータを決定し、"
                    "set_crumble_params ツールで返してください。\n\n"
                    f"指示: {text}"
                ),
            }],
        )
        for block in msg.content:
            if getattr(block, "type", None) == "tool_use":
                return _sanitize_llm(dict(block.input))
        print("[prompt_parser] LLM 応答に tool_use が無い", file=sys.stderr)
        return {}
    except Exception as e:
        print(f"[prompt_parser] LLM 呼び出し失敗: {e}", file=sys.stderr)
        return {}


def _sanitize_llm(d: dict) -> dict:
    """LLM 出力を範囲内に丸める。"""
    out = {}
    if d.get("type") in ("barrel", "rock", "glass"):
        out["type"] = d["type"]
    if "pieces" in d:
        out["pieces"] = _clamp_int(int(d["pieces"]), 2, 999)
    for k, lo, hi in [("size", 0.1, 10.0), ("weight", 0.1, 100.0),
                      ("fragility", 0.0, 1.0), ("friction", 0.0, 1.0),
                      ("restitution", 0.0, 1.0)]:
        if k in d and d[k] is not None:
            out[k] = _clamp_float(float(d[k]), lo, hi)
    return out


# ============================================================
#  CLI（デバッグ用）
# ============================================================
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("使い方: python prompt_parser.py \"<プロンプト>\" [--llm]", file=sys.stderr)
        sys.exit(1)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    use_llm = "auto" if "--no-llm" not in sys.argv else False
    if "--llm" in sys.argv:
        use_llm = True
    prompt = " ".join(args)
    result = parse(prompt, use_llm=use_llm)
    import json
    print(json.dumps(result, ensure_ascii=False, indent=2))
