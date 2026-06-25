#!/usr/bin/env python3
"""
prompt_parser のルールベース解析テスト（LLM を使わず決定論的に検証）。

実行:
    python tests/test_prompt_parser.py
    pytest tests/test_prompt_parser.py -v
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from prompt_parser import parse, parse_rules, profile_for, TYPES, TYPE_PROFILES  # noqa: E402


def _rules(text):
    return parse(text, use_llm=False)


def test_type_barrel():
    assert _rules("樽を作って")["type"] == "barrel"
    assert _rules("酒樽を壊す")["type"] == "barrel"
    assert _rules("a wooden barrel")["type"] == "barrel"


def test_type_rock():
    assert _rules("大きな岩")["type"] == "rock"
    assert _rules("石を粉々に")["type"] == "rock"
    assert _rules("巨大な岩塊")["type"] == "rock"
    assert _rules("かたまりを壊す")["type"] == "rock"


def test_type_glass():
    assert _rules("窓ガラスを割る")["type"] == "glass"
    assert _rules("ガラス板")["type"] == "glass"


def test_type_new_objects():
    assert _rules("木箱を壊す")["type"] == "crate"
    assert _rules("花瓶を割る")["type"] == "vase"
    assert _rules("壺")["type"] == "vase"
    assert _rules("カボチャを粉々に")["type"] == "pumpkin"
    assert _rules("氷の塊を砕く")["type"] == "ice"
    assert _rules("植木鉢")["type"] == "pot"
    assert _rules("墓石")["type"] == "tombstone"
    assert _rules("コンクリのブロック")["type"] == "concrete"
    assert _rules("卵を割る")["type"] == "egg"


def test_type_longest_match_wins():
    # "石柱" は "石"(rock) を含むが、より長い "石柱" が pillar として勝つ
    assert _rules("古い石柱")["type"] == "pillar"
    # "石碑" も同様に tombstone（"石" rock に勝つ）
    assert _rules("石碑")["type"] == "tombstone"


def test_profiles_cover_all_types():
    # すべての種別にプロファイルがあり、各値が妥当な範囲
    for t in TYPES:
        p = profile_for(t)
        assert p, f"{t} にプロファイルが無い"
        assert 0.0 <= p["fragility"] <= 1.0
        assert 0.0 <= p["friction"] <= 1.0
        assert 0.0 <= p["restitution"] <= 1.0
        assert p["weight"] > 0
        assert p["pieces"] >= 2


def test_profile_character():
    # 石柱は卵より遥かに重く頑丈、卵は軽くて即割れ
    assert TYPE_PROFILES["pillar"]["weight"] > TYPE_PROFILES["egg"]["weight"]
    assert TYPE_PROFILES["pillar"]["fragility"] < TYPE_PROFILES["egg"]["fragility"]
    # 氷はよく滑る（摩擦が低い）
    assert TYPE_PROFILES["ice"]["friction"] < 0.2


def test_pieces_extraction():
    assert _rules("樽を30破片で")["pieces"] == 30
    assert _rules("20個に割る岩")["pieces"] == 20
    assert _rules("ガラスを15ピース")["pieces"] == 15
    assert _rules("rock pieces 25")["pieces"] == 25


def test_pieces_clamped():
    assert _rules("樽を9999個")["pieces"] == 999
    assert _rules("樽を1個")["pieces"] == 2  # 最小2


def test_seed_extraction():
    assert _rules("樽 シード42")["seed"] == 42
    assert _rules("rock seed 7")["seed"] == 7
    assert _rules("岩 種3")["seed"] == 3


def test_weight_adjectives():
    assert _rules("重い樽")["weight"] >= 45
    assert _rules("軽い樽")["weight"] <= 5
    assert _rules("超重い岩")["weight"] >= 90


def test_fragility_adjectives():
    assert _rules("脆いガラス")["fragility"] >= 0.85
    assert _rules("頑丈な樽")["fragility"] <= 0.2
    assert _rules("粉々に割れる岩")["fragility"] == 1.0


def test_fragility_high_bumps_pieces():
    # 粉々（fragility=1.0）かつ破片数の明示なし → pieces を増やす
    r = _rules("樽を粉々に")
    assert r["fragility"] == 1.0
    assert r["pieces"] == 40
    # 明示数値があればそちら優先
    r2 = _rules("樽を粉々に10個で")
    assert r2["pieces"] == 10


def test_friction_restitution():
    assert _rules("ツルツルした岩")["friction"] <= 0.1
    assert _rules("ザラザラの岩")["friction"] >= 0.8
    assert _rules("よく跳ねるゴムの樽")["restitution"] >= 0.7


def test_size():
    assert _rules("2倍の大きさの樽")["size"] == 2.0
    assert _rules("巨大な岩")["size"] == 2.0
    assert _rules("小さいガラス")["size"] == 0.5
    assert _rules("size 0.5 の樽")["size"] == 0.5


def test_material_hints():
    # 鉄 → 重く頑丈
    r = _rules("鉄の樽")
    assert r["type"] == "barrel"
    assert r["weight"] >= 70
    assert r["fragility"] <= 0.2
    # 氷 → 脆く滑る
    r2 = _rules("氷の塊")
    assert r2["fragility"] >= 0.85
    assert r2["friction"] <= 0.1


def test_adjective_overrides_material():
    # 木製(weight=8) だが「重い」(50)が上書きする
    r = _rules("重い木製の樽")
    assert r["weight"] >= 45


def test_complex_prompt():
    r = _rules("重い木製の樽を30破片で派手に割れるように")
    assert r["type"] == "barrel"
    assert r["pieces"] == 30
    assert r["weight"] >= 45
    assert r["fragility"] >= 0.85


def test_empty_returns_empty():
    assert _rules("") == {}
    assert _rules("   ") == {}


def test_unknown_type_omitted():
    # 種別が判定できない（LLM 無効）なら type キーは無い
    r = _rules("何か壊して")
    assert "type" not in r


def _run():
    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        try:
            fn()
            print(f"  ✅ {fn.__name__}")
            passed += 1
        except AssertionError as e:
            print(f"  ❌ {fn.__name__}: {e}")
        except Exception as e:
            print(f"  💥 {fn.__name__}: {type(e).__name__}: {e}")
    print(f"\n{passed}/{len(fns)} passed")
    return passed == len(fns)


if __name__ == "__main__":
    print("=== prompt_parser ルールベーステスト ===")
    sys.exit(0 if _run() else 1)
