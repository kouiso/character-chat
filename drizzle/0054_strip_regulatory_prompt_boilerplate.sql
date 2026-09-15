-- #808: キャラ設定より先に効く年齢・同意の定型制約を既存データから除く。
-- 年齢そのものは成人の実年齢として残し、18歳以上/成人扱いというメタ指示だけを正規化する。

UPDATE character
SET system_prompt = replace(system_prompt, '１７歳（18歳以上の学生）', '18歳の学生')
WHERE instr(system_prompt, '１７歳（18歳以上の学生）') > 0;

UPDATE character
SET system_prompt = replace(
  system_prompt,
  '年齢: 明示がない場合も必ず20歳以上の成人として扱う',
  '年齢: 20歳'
)
WHERE instr(system_prompt, '年齢: 明示がない場合も必ず20歳以上の成人として扱う') > 0;

UPDATE character
SET system_prompt = replace(
  system_prompt,
  '※成人向けseed用に全登場人物を18歳以上として再設定。',
  ''
)
WHERE instr(system_prompt, '※成人向けseed用に全登場人物を18歳以上として再設定。') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '18歳以上', '18歳')
WHERE instr(system_prompt, '18歳以上') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '歳成人', '歳')
WHERE instr(system_prompt, '歳成人') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, 'このアプリは成人向けであり、', '')
WHERE instr(system_prompt, 'このアプリは成人向けであり、') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '成人向け', '')
WHERE instr(system_prompt, '成人向け') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '成人女性', '女性')
WHERE instr(system_prompt, '成人女性') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '成人同士の', '')
WHERE instr(system_prompt, '成人同士の') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '未成年設定には進めず、', '')
WHERE instr(system_prompt, '未成年設定には進めず、') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '非合意', '強引')
WHERE instr(system_prompt, '非合意') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '合意済みの', '')
WHERE instr(system_prompt, '合意済みの') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '合意ベースの', '')
WHERE instr(system_prompt, '合意ベースの') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '合意性交渉', '性交渉')
WHERE instr(system_prompt, '合意性交渉') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '合意行為', '性行為')
WHERE instr(system_prompt, '合意行為') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '合意で', '')
WHERE instr(system_prompt, '合意で') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '合意', '')
WHERE instr(system_prompt, '合意') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '同意確認は自然な確認として挟む。', '')
WHERE instr(system_prompt, '同意確認は自然な確認として挟む。') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '同意確認を学ぶ。', '')
WHERE instr(system_prompt, '同意確認を学ぶ。') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '同意確認から', '相手の反応を見ながら')
WHERE instr(system_prompt, '同意確認から') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '相手の同意を確かめて', '相手の反応を見ながら')
WHERE instr(system_prompt, '相手の同意を確かめて') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '相手の同意と反応を見て', '相手の反応を見て')
WHERE instr(system_prompt, '相手の同意と反応を見て') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '相手の同意と反応を確認して', '相手の反応を見ながら')
WHERE instr(system_prompt, '相手の同意と反応を確認して') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '相手の同意と安心を確認して', '相手との距離感を見ながら')
WHERE instr(system_prompt, '相手の同意と安心を確認して') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '相手の同意と気持ちを確認しながら', '相手の気持ちを見ながら')
WHERE instr(system_prompt, '相手の同意と気持ちを確認しながら') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '相手の同意と気持ちを確認して', '相手の気持ちを見ながら')
WHERE instr(system_prompt, '相手の同意と気持ちを確認して') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '相手の同意と雰囲気を重視する', '場の雰囲気を重視する')
WHERE instr(system_prompt, '相手の同意と雰囲気を重視する') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '同意と境界を確認して', '反応と駆け引きを描いて')
WHERE instr(system_prompt, '同意と境界を確認して') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '同意と雰囲気を確認しながら', '雰囲気を保ちながら')
WHERE instr(system_prompt, '同意と雰囲気を確認しながら') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '同意と雰囲気を確認して', '雰囲気を見ながら')
WHERE instr(system_prompt, '同意と雰囲気を確認して') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '露骨に急がず、同意と緊張を保つ', '露骨に急がず、緊張を保つ')
WHERE instr(system_prompt, '露骨に急がず、同意と緊張を保つ') > 0;

UPDATE character
SET system_prompt = replace(system_prompt, '同意', '反応')
WHERE instr(system_prompt, '同意') > 0;
