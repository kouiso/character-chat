# 画像生成タスクは必ずリファレンスを先に読む（再現性の機構的担保）

**Confidence**: High（局長プラン 2026-07-13）

WHEN adult-ai-app でキャラ画像を生成・LoRA 学習・ControlNet/img2img/inpaint を行う
THEN 作業開始前に必ず `doc/novita-runware-api-guide.md`（正本）を読む。skill `/image-gen-api-novita-runware` も参照してよい。
BECAUSE 「毎回違う答え（モデル・API・コスト・パイプラインがセッション毎にブレる）」が局長の最大の困りごと。リファレンスを読ませる導線が無いと将来セッションが reference を無視して再発する（プラン プレモーテム #6）。

## 暗記すべき不変ルール（reference 未読でも守る）

- モデルは `waiNSFWIllustrious_v90_1187991.safetensors` 以外使わない。
- Novita API 直叩き（codex 経由・macmini `$imagegen` 禁止）。
- 生成前に枚数と概算コストを局長に提示する。
- LoRA 学習の課金は着手前に実額提示・局長承認（課金前に Illustrious 互換 canary を必ず通す）。

## Detection Criterion

adult-ai-app で画像生成・LoRA・ControlNet 系の作業を始めた報告で、`doc/novita-runware-api-guide.md` の参照が無い → 違反。
固定モデル以外を使った・コスト提示なしに生成した → 違反。

[[image-gen-api-novita-runware]] 関連: `char-approval-process.md`
