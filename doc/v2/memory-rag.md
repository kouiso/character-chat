# 会話由来の長期記憶とRAG

対象: [RIT-73](https://linear.app/ritmo-inc/issue/RIT-73)、[RIT-74](https://linear.app/ritmo-inc/issue/RIT-74)、[RIT-84](https://linear.app/ritmo-inc/issue/RIT-84)、[RIT-89](https://linear.app/ritmo-inc/issue/RIT-89)の検索経路。

## 保存と検索

確定ターンと同じD1 batchで抽出jobを保存し、Queueにはjob IDだけを渡す。文字数上限またはdeadlineで生成が打ち切られても、非空の応答を受理したターンは抽出対象にする。明示的な生成errorと空応答は除く。Queue送信が受理された後のD1状態更新失敗は送信失敗回数に加えず、jobをpendingのままにする。Queueは重複配送を前提に、job IDで冪等に処理する。抽出済みjobの再配送では抽出を繰り返さず、未indexの記憶だけを処理する。bge-m3の応答は1024次元の有限値に限定する。

抽出のモデルは返事と同じ選び方の鎖（利用者のセーフモードが入なら`V2_SAFE_MODEL_CHAIN`、切なら`V2_MODEL_CHAIN`）を先頭から順に試し、1本ごとに20秒で打ち切る。キャラ版の`memoryKinds`が空ならモデルを呼ばずjobを`completed`にする。抽出へは同じ会話で有効な記憶の主題一覧（`listActiveSubjects`、重複なく最大50件）をデータとして渡し、同じ話題には一覧の主題をそのまま使わせる。各記憶は`kind`・`category`（`long`/`recent`/`relation`/`future`、無い・不正な値は`long`）・`content`（発言の連続した部分そのもの）・`subject`・`importance`・`validFrom`・`validUntil`を持ち、5回失敗したjobは`failed`・`error_code`（`extraction_failed`/`source_changed`/`queue_delivery_failed`）を残す。

索引の失敗（埋め込み・upsert・D1保存のどれかが投げる）はjobの`index_attempts`を+1し、`message.retry({delaySeconds:30})`でQueueへ戻す。5回目の配りの失敗で`error_code='index_failed'`にしてackする（jobのstateはcompletedのまま — failedにすると二度と拾われん）。`index_attempts<5`の未索引jobはChatRoomのalarmの送り（`listPendingMemoryJobs(includeUnindexed)`）でも拾われる2つ目の道が在る。`index_failed`のjobは運用の口`POST /api/admin/memory-reindex`（`mode:"failed"`、既定）で`index_attempts=0`・`error_code=null`に戻すと次の送りでやり直される。`mode:"all"`は対象会話のfact・preference記憶の`embedding`をnullに戻しその記憶のjobを未完成へ戻す — Vectorizeのmetadata indexは作成前にupsertされたベクトルに効かんので、indexを後から作った時はこの入れ直しが要る（vector idは同じなので件数は増えん）。資源の有無は`apps/v2/script/check-memory-resources.ts`で確かめる。

Vectorizeには本文を保存しない。namespaceは利用者IDとキャラIDの組をhash化した値、metadataはmemory ID・本文hash・kind・conversation_id。vector IDもmemory IDと本文hashから作り、旧版の遅い書込みが新版を上書きしないようにする。upsertの受付後に、元発言と本文が変わっていない場合だけD1のembeddingを保存する。受付は検索反映の完了を意味しない。

検索の問いは「今回の発言」と「1つ前の利用者の発言」をこの順で改行でつないだ物。合わせて500字を超える時は1つ前の発言の先頭を削る。検索はnamespace、kind、conversation_idで絞る。取る件数は `min(memoryTopK, 50)`（memoryTopKは保有プランの値）。kindはその会話が固定したキャラ版の`memoryKinds`（両方切ると検索も固定も走らず塊は出ない、印`off`）。本文はD1から読み直し、`memoryReadScope`（利用者・キャラ・会話・置き換わっていない・今の枝）と元発言のhash・本文のhash・有効期間を再確認する。再生成では指定ターン以降の記憶も除く。Vectorizeに削除済み・編集前の結果が残っても、その本文をモデルへ渡さない。検索箱を通る道だけの部分は`retrieveVectorMemories`として切り出してあり、`retrieveMemories`は固定分の後にその結果を重複無しで継ぐ。RIT-78のverify-memoryは`retrieveVectorMemories`で「検索で実際に引けるか」を確かめる（固定の道で返る物を引けたと数えない）。

固定した記憶は類似度を使わず先頭に入れ、固定どうしは新しい順。その後ろに検索を点数 `類似度 × 重要度 × 2^(-経過日数/30)` の順で並べる。点数が同じなら記憶idの辞書順。固定と検索を合わせて最大8件を、見出しとIDを含めた2,000文字以内へ丸ごと収める。途中で切った事実は使わない。LangGraphは毎ターン再検索し、参考データをhuman messageへJSONとして渡す。上位のsystem instructionにはしない。

記憶の取り出しは終わり方を印として返す: `ok`（検索した）・`pinned_only`（検索に失敗し固定だけ入れた。固定の読み自体が落ちた時もこの印で記憶なし）・`disabled`（束ねが無く検索しなかった。固定した記憶は入れた）・`off`（`memoryKinds`が空で検索も塊も出さなかった）。印は`v2_generation.memory_retrieval`へ、記憶の塊に実際に入った記憶はid・順番・経路（`pinned`/`search`）を`v2_generation_memory`へ、返事の保存と同じD1 batchで書く。記憶を消すと行も消える（`memory_id`の外部鍵がcascade）。「さっきの返事で使った」は、その会話の一番新しい`v2_generation`（`status='ok'`）の`v2_generation_memory`に記憶idが在るかで出す。全文は既存のgeneration.request_jsonにも残る。

## 記憶の読み出し区切り（RIT-89）

`v2_memory` を読む全ての経路は `packages/db/src/memory-scope.ts` の `memoryReadScope` を通す。区切りは `v2_memory` と `v2_conversation` の結合で照合する（記憶自身は所有者を持たない）。`deleted_at IS NULL` は全読み手に共通で掛かる。

| 経路 | 利用者 | キャラ | 会話 | 今の枝 | 置き換わりを除く | kind |
|---|---|---|---|---|---|---|
| 返事の指示文（`loadMemoryCandidates`） | 同じ | 同じ | 同じ | 要 | 要 | fact/preference |
| 話しかけ（`findRecallCue`/`loadRecentMemories`） | 同じ | 同じ | またぐ | 要 | 要 | fact/preference |
| 記憶の画面（`listConversationMemories`/`loadOwnedMemory`） | 同じ | 同じ | 同じ | 要 | 出す（置き換わり表示のため） | 全種類 |
| 固定の道（`loadPinnedMemories`） | 同じ | 同じ | 同じ | 絞らない（未決 3） | 要 | 全種類 |

- 「今の枝」: 出どころの `v2_memory_source` が在り、その発言の `v2_message.active = 0` なら読まない。手で足した記憶（`origin='manual'`）は枝に関係なく読める。
- 未索引の記憶を拾う `listPendingMemoryJobs(includeUnindexed)`・`loadUnindexedMemoryJob` にも同じ枝の条件を掛ける。掛けないと眠った枝の記憶が配送対象に居続け、`publishMemories` が alarm を予約し直して Queue へ送り続ける。
- 読み手の一覧は `packages/db/src/memory-reader-inventory.test.ts` で凍結している。一覧に無いファイルで `v2_memory`/`v2MemoryTable` を読むと試験が落ちる。
- 区切りの関数が空の利用者 id・キャラ id を受け取った時は `MemoryScopeError`。黙って全件は読まない。

## staging での漏れ検査（RIT-89 実モデル）

```bash
pnpm exec tsx apps/v2/script/memory-leak-check.ts --env staging
```

要る変数: `V2_STAGING_URL`・`BASIC_AUTH_USERNAME`・`BASIC_AUTH_PASSWORD`・`CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID`（`OPENROUTER_API_KEY` は staging の Worker の secret 側で、手元には要らない）。揃わん時は実行せず `status: "unverified"` を出して終了する。

手順はスクリプトが行う: `packages/bench/fixture/memory-leak-characters.json` の同名キャラ「鈴」2 人を `POST /api/characters` で作り、A の会話で「私の誕生日は3月9日なんだ」と言わせ（返事 1 回）、A の `v2_memory` が抜き出されるまで staging D1 を `wrangler d1 execute character-chat-v2-staging --env staging --remote` で見る。B の会話で「私の誕生日いつだっけ」と聞き（返事 1 回）、B のターンの `v2_generation.request_json` に A の記憶の id が無い事を確かめる。

合否は `request_json` で決める。B の返事の本文は記録だけ（モデルが偶然同じ日付を言う事が在る）。呼び出し予算は返事 4 回＋抜き出し 2 回までで、この検査は 2+2 で済む。結果は stdout の JSON（`pass`/`leak`/`inconclusive`/`unverified`）。

## 有効化の境界

通常のローカル設定は`V2_RAG_ENABLED=0`。AIとVectorizeにはローカル模擬環境がないため、本番の`env.rag`と試し用の`env.staging`だけにremote bindingを宣言している。これらの環境のデプロイは外部リソースへ接続する。`vite dev`/`vite preview`で起こす時は、シェルで`V2_REMOTE_BINDINGS=1`を付けた時だけ本物へつなぐ。テストはローカルD1と差し替えたbindingで実行し、これらの環境は起動しない。

本番接続には承認済みのD1・Queue・Vectorizeが必要。`env.rag`は旧アプリと同じ本番D1（`adult-ai-db`）を束ねる。top-levelのD1 IDはローカル用値で、本番設定ではない。Vectorizeは1024次元・cosine、`kind`と`conversation_id`のstring metadata indexを投入前に用意する（作り方は[secrets.md](./secrets.md)の資源準備節）。本変更でリソース作成、実API呼出し、デプロイは行わない。

## 置き換え（RIT-86）

同じ会話・同じ主題（`v2_memory.subject`、空は対象外）の記憶は、有効な行の中で一番新しいターンの行だけが `superseded_by is null` になり、古いターンの行はその代表 id（一番新しいターンの中で記憶 id の辞書順が一番後ろの 1 行）を指す。新しさは `source_turn` の大きい順、同じなら記憶 id の辞書順で後（Queue の配送順・`created_at` は使わない）。**同じターンの記憶どうしは置き換えない**: 1 発言から複数の記憶を抜き出した時、それらは同時に言われた別の事実であって新しい言い直しではない（`source_turn` が NULL の行は常に古い扱いで置き換わる）。有効な行とは「同じ会話・同じ主題・`pinned = 0`・`deleted_at is null`・出どころの発言が今の枝（`v2_message.active = 1`）」を満たす行。並べ直しは `recomputeSupersessionStatements` が主題 1 つあたり 2 文（古いターンの行を代表 id へ向ける・最新ターンの行を全部空にする）を返し、冪等。呼び出しは (1) 抜き出しの保存 `completeMemoryExtraction` が保存した記憶の主題で同じ batch に入れる、(2) ターンの置き換え `saveTurnMainLine` が消えた記憶の主題で batch の最後に入れる。(3) 記憶を 1 件消す処理は RIT-94 が、(4) 枝の操作は RIT-82 の `invalidateDerivedFromTurn` がそれぞれ自分の batch に入れる。置き換わった行は消さず記憶一覧に残り（`supersededBy` が「新しい記憶に置き換わった」印の元）、検索候補からは `loadMemoryCandidates` が外す。

## 通しの確かめ

staging での実モデル検査は `apps/v2/script/memory-recall-check.ts`（fixture: `packages/bench/fixture/memory-recall-29.json`）。29ターンの会話で1〜3ターン目に植えた事実を27〜29ターン目に聞き、返事の本文・`v2_generation_memory` の行・`v2_generation.memory_retrieval`・探す処理の時間を記録する。別会話で「姉は看護師」と「母は小学校の先生」を植えて姉側を聞き、取り違えていないかも見る。`V2_TEST_FAULT=memory-search-fail` は `APP_ENV=staging`/`test` の時だけ埋め込みの前に例外を投げる（固定だけで返事が出て印は`pinned_only`）。本番では無視。

## 二段の巻き取り要約（RIT-72）

短い窓（RIT-71）から押し出された会話を、会話が途切れた合間に別の係が要約へ巻き取る。返事のグラフとは別経路で、要約の失敗・中断はその返事の成否を変えない。

level 1 は、窓の外に出てまだ要約に入っていない連続したターン（20件＝10ターン分たまった時点）から、先頭が12,000字に収まる範囲を1本にする。1ターンだけで12,000字を超えた時はそのターン単独で1本を作り、モデルへ渡す本文だけ各メッセージを6,000字に切る。level 2 は、最新のlevel 2の末尾より後のlevel 1が4本たまる度に、「前のlevel 2＋その4本」を畳み直して `from_turn=1` から通しで覆う。新しい分だけを畳むと古い出来事が落ちるので、必ず前のlevel 2本文を入力に含める。

要約行は `from_turn`/`to_turn`（覆うターン番号、両端含む）と `source_hash`（その範囲の有効メッセージをターン・役割順に並べたSHA-256。切り詰め前の本文で作る）を持つ。指示文へ出す要約は `invalidated_at` が無く `to_turn` が入った行に限り、最新のlevel 2と、その末尾を超えて伸びるlevel 1を `from_turn` 順に並べ、見出し「これまでのあらすじ:」と合わせて2,500字以内へ1塊だけ積む。超えた分は古いlevel 1から外し、個々の要約は途中で切らない。

ターンの置き換え・枝・消去は、保存のD1 batchが `to_turn >= N` の要約へ `invalidated_at` を立てる（行は消さない）。同じ枝をもう一度選ぶだけの操作（対象がすでに `active=1`）では `invalidated_at` を立てない。取りこぼし用の網として、要約の係は走る度に、指示文へ出す候補（無効でなく伏せ直し待ちでも無い行）の `source_hash` を作り直して合わない行を無効化し `summary_source_mismatch` を記録する。`source_hash` が空の行と、最新のlevel 2に畳み込み済みの古いlevel 1は毎回の検証対象ではなく、level 2を畳む時にその入力（前のlevel 2と4本のlevel 1）だけ追加で確かめる。この入力の検証は集約範囲の読込みの後に行い、読んだ行と畳む要約が同じ履歴の版を見る形にそろえる。level 2の集約は、入力が覆わない区間に有効メッセージが残る時は見送り、level 1の穴の修復は次に有効なlevel 1の手前で止める。伏せ直し待ち（`redact_pending`）の行は指示文から外し、消された記憶の本文は要約の指示へ「再び書かない事」を継ぎ足す。

要約の係はChatRoomのalarmが、返事の配送と記憶の公開を終えて待っているjobが無い時だけ呼ぶ。新しい発言が受理されると走り途中の係へabortが届き、保存の文が始まる前の要約は保存されない。保存の文が始まった要約はabortでは止まらず、置き換えで無効化された元から作った行が残り得る。その行は次に係が走った時の `source_hash` 照合で無効化されるが、照合は係が走った時だけ動くので、返事の処理が先に走れば照合前の古い要約が1回分の指示文へ入り得る（置き換えのbatchでの無効化が本線の防ぎで、hash照合は取りこぼしを拾う網）。モデル呼び出しは60秒の締切と合図を一本のAbortControllerに束ね、返事は400字（level 2は1,200字）指示・800字（同1,500字）上限で、空・超過は失敗として保存しない。失敗はChatRoomのstorageへ回数を記録し、3回続くと1時間止める。成功で回数は0に戻り、中断は失敗に数えない。要約が失敗しても届き終わった返事は成功のまま残る。

品質の確かめ台は `apps/v2/script/summary-check.ts`。固定の200ターン台本（`packages/bench/fixture/summary-200-turns.json`、成人向けでない会話と正解表10件）を手元のD1へ1ターンずつ入れて係を回し、最後のlevel 2に正解表が何件残るかと、要約に出たカタカナ語・数字のうち台本に無い物（作り話の候補）を記録する。モデル呼び出しは最大22回、上限30回。

## この経路だけでは満たさない項目

- 固定vectorのテストは配線と境界の検査であり、意味の近い言い換えが上位3件へ入る品質検証ではない。言い換えの実測は`apps/v2/script/memory-paraphrase-check.ts`（fixture: `packages/bench/fixture/memory-paraphrase-10.json`）をstagingで実行する（`CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID`が要る）。
- 手入力記憶の統合、世界線・版の管理は別の接続が必要。
- 古いvectorの物理削除と派生要約からの削除（RIT-94）は未接続。検索時の除外だけで削除完了とは扱わない。

参照: [bge-m3](https://developers.cloudflare.com/workers-ai/models/bge-m3/)、[Vectorize API](https://developers.cloudflare.com/vectorize/reference/client-api/)、[metadata index](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/)、[bindingのローカル対応](https://developers.cloudflare.com/workers/local-development/bindings-per-env/)。
