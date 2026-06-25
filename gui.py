#!/usr/bin/env python3
"""
Crumble — デスクトップ GUI

pipeline.py をフォーム UI から呼び出して GLB を生成する tkinter アプリ。
標準ライブラリのみで動作するため、Windows / macOS / Linux で追加依存なしに起動できる。

起動:
    python gui.py
"""
import json
import queue
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, ttk

import prompt_parser

ROOT_DIR = Path(__file__).parent.resolve()
PIPELINE = ROOT_DIR / "pipeline.py"
CONFIG_PATH = Path.home() / ".crumble_gui.json"

TYPES = ["barrel", "rock", "glass"]
TYPE_LABELS = {"barrel": "樽 (barrel)", "rock": "岩 (rock)", "glass": "ガラス板 (glass)"}


def load_config() -> dict:
    try:
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_config(cfg: dict):
    try:
        CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


class CrumbleGUI:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.cfg = load_config()
        self.proc = None
        self.log_queue = queue.Queue()
        self.parse_queue = queue.Queue()
        self._customized_out = False
        self._val_labels = {}   # key -> (val_label, fmt) スライダー値表示

        root.title("Crumble — 破壊可能3Dオブジェクト生成")
        root.minsize(620, 640)

        self._build_ui()
        self._on_type_change()
        self.root.after(100, self._drain_log)
        self.root.after(100, self._drain_parse)

    # ---------------- UI 構築 ----------------
    def _build_ui(self):
        pad = {"padx": 8, "pady": 4}
        frm = ttk.Frame(self.root, padding=12)
        frm.pack(fill="both", expand=True)
        frm.columnconfigure(1, weight=1)

        row = 0

        # --- プロンプト（自然言語） ---
        ttk.Label(frm, text="プロンプト").grid(row=row, column=0, sticky="w", **pad)
        self.var_prompt = tk.StringVar(value=self.cfg.get("prompt", ""))
        prompt_entry = ttk.Entry(frm, textvariable=self.var_prompt)
        prompt_entry.grid(row=row, column=1, sticky="ew", **pad)
        prompt_entry.bind("<Return>", lambda e: self._analyze_prompt())
        self.btn_analyze = ttk.Button(frm, text="解析→反映", command=self._analyze_prompt)
        self.btn_analyze.grid(row=row, column=2, **pad)
        row += 1
        ttk.Label(frm, text='例: 「重い木製の樽を30破片で派手に割れるように」',
                  foreground="#888").grid(row=row, column=1, columnspan=2, sticky="w", padx=8)
        row += 1
        ttk.Separator(frm, orient="horizontal").grid(
            row=row, column=0, columnspan=3, sticky="ew", padx=8, pady=6)
        row += 1

        # --- type ---
        ttk.Label(frm, text="種別").grid(row=row, column=0, sticky="w", **pad)
        self.var_type = tk.StringVar(value=self.cfg.get("type", "barrel"))
        self.type_menu = ttk.Combobox(
            frm, textvariable=self.var_type, state="readonly",
            values=[TYPE_LABELS[t] for t in TYPES],
        )
        self.type_menu.set(TYPE_LABELS[self.var_type.get()])
        self.type_menu.grid(row=row, column=1, columnspan=2, sticky="ew", **pad)
        self.type_menu.bind("<<ComboboxSelected>>", lambda e: self._on_type_change())
        row += 1

        # --- pieces ---
        self.var_pieces = tk.IntVar(value=self.cfg.get("pieces", 20))
        row = self._add_spin(frm, row, "破片数 (pieces)", self.var_pieces, 2, 999, 1)

        # --- seed ---
        self.var_seed = tk.IntVar(value=self.cfg.get("seed", 1))
        row = self._add_spin(frm, row, "シード (seed)", self.var_seed, 0, 999999, 1)

        # --- size ---
        self.var_size = tk.DoubleVar(value=self.cfg.get("size", 1.0))
        row = self._add_scale(frm, row, "サイズ (size)", self.var_size, 0.1, 5.0, 0.1, "size")

        # --- weight ---
        self.var_weight = tk.DoubleVar(value=self.cfg.get("weight", 10.0))
        row = self._add_scale(frm, row, "質量 kg (weight)", self.var_weight, 0.1, 100.0, 0.1, "weight")

        # --- fragility ---
        self.var_fragility = tk.DoubleVar(value=self.cfg.get("fragility", 0.5))
        row = self._add_scale(frm, row, "壊れやすさ (fragility)", self.var_fragility, 0.0, 1.0, 0.01, "fragility")

        # --- friction ---
        self.var_friction = tk.DoubleVar(value=self.cfg.get("friction", 0.5))
        row = self._add_scale(frm, row, "摩擦 (friction)", self.var_friction, 0.0, 1.0, 0.01, "friction")

        # --- restitution ---
        self.var_restitution = tk.DoubleVar(value=self.cfg.get("restitution", 0.3))
        row = self._add_scale(frm, row, "反発 (restitution)", self.var_restitution, 0.0, 1.0, 0.01, "restitution")

        # --- impact (glass のみ) ---
        self.var_impact_x = tk.DoubleVar(value=self.cfg.get("impact_x", 0.0))
        self.lbl_ix, self.scale_ix, row = self._add_scale_ref(
            frm, row, "衝突点X (impact-x)", self.var_impact_x, -1.0, 1.0, 0.05, "impact_x")
        self.var_impact_y = tk.DoubleVar(value=self.cfg.get("impact_y", 0.0))
        self.lbl_iy, self.scale_iy, row = self._add_scale_ref(
            frm, row, "衝突点Y (impact-y)", self.var_impact_y, -1.0, 1.0, 0.05, "impact_y")

        # --- 出力先 ---
        ttk.Label(frm, text="出力先 (out)").grid(row=row, column=0, sticky="w", **pad)
        self.var_out = tk.StringVar(value=self.cfg.get("out", str(ROOT_DIR / "output" / "barrel.glb")))
        out_entry = ttk.Entry(frm, textvariable=self.var_out)
        out_entry.grid(row=row, column=1, sticky="ew", **pad)
        out_entry.bind("<Key>", lambda e: setattr(self, "_customized_out", True))
        ttk.Button(frm, text="参照…", command=self._browse_out).grid(row=row, column=2, **pad)
        row += 1

        # --- Blender パス ---
        ttk.Label(frm, text="Blender パス").grid(row=row, column=0, sticky="w", **pad)
        self.var_blender = tk.StringVar(value=self.cfg.get("blender", "blender"))
        ttk.Entry(frm, textvariable=self.var_blender).grid(row=row, column=1, sticky="ew", **pad)
        ttk.Button(frm, text="参照…", command=self._browse_blender).grid(row=row, column=2, **pad)
        row += 1

        # --- 生成ボタン ---
        self.btn_generate = ttk.Button(frm, text="🔨 生成", command=self._generate)
        self.btn_generate.grid(row=row, column=0, columnspan=3, sticky="ew", padx=8, pady=(10, 4))
        row += 1

        # --- ログ ---
        ttk.Label(frm, text="ログ").grid(row=row, column=0, sticky="w", **pad)
        row += 1
        log_frame = ttk.Frame(frm)
        log_frame.grid(row=row, column=0, columnspan=3, sticky="nsew", padx=8, pady=4)
        frm.rowconfigure(row, weight=1)
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        self.log = tk.Text(log_frame, height=10, wrap="word", bg="#11131a", fg="#cfe3ff",
                           insertbackground="#cfe3ff", relief="flat")
        self.log.grid(row=0, column=0, sticky="nsew")
        scroll = ttk.Scrollbar(log_frame, command=self.log.yview)
        scroll.grid(row=0, column=1, sticky="ns")
        self.log.configure(yscrollcommand=scroll.set, state="disabled")

    def _add_spin(self, frm, row, label, var, lo, hi, step):
        pad = {"padx": 8, "pady": 4}
        ttk.Label(frm, text=label).grid(row=row, column=0, sticky="w", **pad)
        ttk.Spinbox(frm, from_=lo, to=hi, increment=step, textvariable=var, width=10).grid(
            row=row, column=1, sticky="w", **pad)
        return row + 1

    def _add_scale(self, frm, row, label, var, lo, hi, step, key=None):
        _, _, nrow = self._add_scale_ref(frm, row, label, var, lo, hi, step, key)
        return nrow

    def _add_scale_ref(self, frm, row, label, var, lo, hi, step, key=None):
        pad = {"padx": 8, "pady": 4}
        lbl = ttk.Label(frm, text=label)
        lbl.grid(row=row, column=0, sticky="w", **pad)
        val_lbl = ttk.Label(frm, text=self._fmt(var.get()), width=6)
        val_lbl.grid(row=row, column=2, sticky="e", **pad)
        if key:
            self._val_labels[key] = val_lbl

        def on_move(v):
            # ステップに丸める
            fv = round(float(v) / step) * step
            var.set(round(fv, 4))
            val_lbl.configure(text=self._fmt(var.get()))

        scale = ttk.Scale(frm, from_=lo, to=hi, variable=var, command=on_move)
        scale.grid(row=row, column=1, sticky="ew", **pad)
        return lbl, scale, row + 1

    @staticmethod
    def _fmt(v):
        return f"{float(v):.2f}"

    # ---------------- イベント ----------------
    def _selected_type(self) -> str:
        label = self.type_menu.get()
        for t, lab in TYPE_LABELS.items():
            if lab == label:
                return t
        return "barrel"

    def _on_type_change(self):
        # 注意: Combobox の textvariable(var_type) にはラベルが入る。
        # ここでキー(t)を set すると表示が壊れ、_selected_type が
        # ラベル照合に失敗して barrel にフォールバックしてしまうため設定しない。
        t = self._selected_type()
        is_glass = (t == "glass")
        state = "normal" if is_glass else "disabled"
        self.scale_ix.configure(state=state)
        self.scale_iy.configure(state=state)
        self.lbl_ix.configure(foreground="" if is_glass else "#777")
        self.lbl_iy.configure(foreground="" if is_glass else "#777")

        # 出力先をユーザーが手動編集していなければ type に追従
        if not self._customized_out:
            self.var_out.set(str(ROOT_DIR / "output" / f"{t}.glb"))

    # ---------------- プロンプト解析 ----------------
    def _analyze_prompt(self):
        text = self.var_prompt.get().strip()
        if not text:
            return
        self.btn_analyze.configure(state="disabled", text="解析中…")
        self._log_write(f"🔎 プロンプト解析: {text}\n")
        threading.Thread(target=self._run_analyze, args=(text,), daemon=True).start()

    def _run_analyze(self, text):
        try:
            # LLM はキー/パッケージがあれば自動利用、無ければルールベース
            parsed = prompt_parser.parse(text, use_llm="auto")
            self.parse_queue.put(("ok", parsed))
        except Exception as e:
            self.parse_queue.put(("err", str(e)))

    def _drain_parse(self):
        try:
            while True:
                status, payload = self.parse_queue.get_nowait()
                self.btn_analyze.configure(state="normal", text="解析→反映")
                if status == "ok":
                    self._apply_parsed(payload)
                else:
                    self._log_write(f"❌ 解析エラー: {payload}\n")
        except queue.Empty:
            pass
        self.root.after(100, self._drain_parse)

    def _apply_parsed(self, d: dict):
        """解析結果（部分辞書）をフォームに反映する。"""
        if not d:
            self._log_write("  （該当パラメータを抽出できませんでした）\n")
            return
        if "type" in d:
            self.type_menu.set(TYPE_LABELS[d["type"]])
            self._on_type_change()
        if "pieces" in d:
            self.var_pieces.set(int(d["pieces"]))
        if "seed" in d:
            self.var_seed.set(int(d["seed"]))
        for key, var in [
            ("size", self.var_size), ("weight", self.var_weight),
            ("fragility", self.var_fragility), ("friction", self.var_friction),
            ("restitution", self.var_restitution),
            ("impact_x", self.var_impact_x), ("impact_y", self.var_impact_y),
        ]:
            if key in d:
                var.set(round(float(d[key]), 4))
                lbl = self._val_labels.get(key)
                if lbl:
                    lbl.configure(text=self._fmt(var.get()))
        self._log_write(f"  → 反映: {d}\n")

    def _browse_out(self):
        path = filedialog.asksaveasfilename(
            title="GLB 出力先",
            defaultextension=".glb",
            filetypes=[("GLB", "*.glb"), ("All", "*.*")],
            initialfile=Path(self.var_out.get()).name,
            initialdir=str(Path(self.var_out.get()).parent),
        )
        if path:
            self.var_out.set(path)
            self._customized_out = True

    def _browse_blender(self):
        path = filedialog.askopenfilename(title="Blender 実行ファイルを選択")
        if path:
            self.var_blender.set(path)

    def _log_write(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text)
        self.log.see("end")
        self.log.configure(state="disabled")

    def _drain_log(self):
        try:
            while True:
                line = self.log_queue.get_nowait()
                if line is None:
                    self.btn_generate.configure(state="normal", text="🔨 生成")
                else:
                    self._log_write(line)
        except queue.Empty:
            pass
        self.root.after(100, self._drain_log)

    # ---------------- 生成 ----------------
    def _generate(self):
        if self.proc is not None:
            return
        t = self._selected_type()
        out = self.var_out.get().strip()
        if not out:
            self._log_write("⚠ 出力先を指定してください\n")
            return

        cmd = [
            sys.executable, str(PIPELINE),
            "--type", t,
            "--pieces", str(int(self.var_pieces.get())),
            "--seed", str(int(self.var_seed.get())),
            "--size", f"{self.var_size.get():.3f}",
            "--weight", f"{self.var_weight.get():.3f}",
            "--fragility", f"{self.var_fragility.get():.3f}",
            "--friction", f"{self.var_friction.get():.3f}",
            "--restitution", f"{self.var_restitution.get():.3f}",
            "--out", out,
            "--blender", self.var_blender.get().strip() or "blender",
        ]
        if t == "glass":
            cmd += [
                "--impact-x", f"{self.var_impact_x.get():.3f}",
                "--impact-y", f"{self.var_impact_y.get():.3f}",
            ]

        self._save_current_config()

        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")
        self._log_write("$ " + " ".join(cmd) + "\n\n")
        self.btn_generate.configure(state="disabled", text="生成中…")

        threading.Thread(target=self._run, args=(cmd,), daemon=True).start()

    def _run(self, cmd):
        try:
            self.proc = subprocess.Popen(
                cmd, cwd=str(ROOT_DIR),
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, encoding="utf-8", errors="replace", bufsize=1,
            )
            for line in self.proc.stdout:
                self.log_queue.put(line)
            self.proc.wait()
            code = self.proc.returncode
            if code == 0:
                self.log_queue.put(f"\n✅ 完了 (exit {code})\n")
            else:
                self.log_queue.put(f"\n❌ 失敗 (exit {code})\n")
        except FileNotFoundError as e:
            self.log_queue.put(f"\n❌ 実行ファイルが見つかりません: {e}\n"
                               "  → Blender パスを確認してください\n")
        except Exception as e:
            self.log_queue.put(f"\n❌ エラー: {e}\n")
        finally:
            self.proc = None
            self.log_queue.put(None)

    def _save_current_config(self):
        save_config({
            "prompt": self.var_prompt.get(),
            "type": self._selected_type(),
            "pieces": int(self.var_pieces.get()),
            "seed": int(self.var_seed.get()),
            "size": round(self.var_size.get(), 3),
            "weight": round(self.var_weight.get(), 3),
            "fragility": round(self.var_fragility.get(), 3),
            "friction": round(self.var_friction.get(), 3),
            "restitution": round(self.var_restitution.get(), 3),
            "impact_x": round(self.var_impact_x.get(), 3),
            "impact_y": round(self.var_impact_y.get(), 3),
            "out": self.var_out.get(),
            "blender": self.var_blender.get(),
        })


def main():
    root = tk.Tk()
    CrumbleGUI(root)
    root.mainloop()


if __name__ == "__main__":
    main()
