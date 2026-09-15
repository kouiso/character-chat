# avatar-clean post-process (Fix #146)

MIG v4 で生成した `profile.png` に焼き込まれた like counter UI を除去して、clean avatar を出力するスクリプトです。

## 依存

```bash
pip install opencv-python numpy
```

## 使い方

```bash
python scripts/avatar-clean/run.py \
  --input /tmp/originals \
  --output /tmp/originals-clean
```

### Dry run

```bash
python scripts/avatar-clean/run.py --dry-run
```

## 処理戦略

1. 右下 33% ROI で白背景 + dark text の矩形を contour 検出
2. 検出成功時は inpaint で除去
3. 検出失敗時は右下 200x80 を平均色で fill (fallback)
4. portrait aspect を維持したまま縦を約 800px に center recrop

## ログ

- 進捗: `[1/25] processing <id>... -> output ...`
- 異常時: `WARN(ui not detected; fallback mask)` または `WARN(copy fallback)`
