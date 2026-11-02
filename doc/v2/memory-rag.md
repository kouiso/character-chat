# 会話由来の長期記憶とRAG

対象: [RIT-73](https://linear.app/ritmo-inc/issue/RIT-73)、[RIT-74](https://linear.app/ritmo-inc/issue/RIT-74)、[RIT-84](https://linear.app/ritmo-inc/issue/RIT-84)、[RIT-89](https://linear.app/ritmo-inc/issue/RIT-89)の検索経路。

## 保存と検索

確定ターンと同じD1 batchで抽出jobを保存し、Queueにはjob IDだけを渡す。抽出済みjobの再配送では抽出を繰り返さず、未indexの記憶だけを処理する。bge-m3の応答は1024次元の有限値に限定する。

Vectorizeには本文を保存しない。namespaceは利用者IDとキャラIDの組をhash化した値、metadataはmemory ID・本文hash・kind・conversation_id。vector IDもmemory IDと本文hashから作り、旧版の遅い書込みが新版を上書きしないようにする。upsertの受付後に、元発言と本文が変わっていない場合だけD1のembeddingを保存する。受付は検索反映の完了を意味しない。

検索はnamespace、kind、conversation_idで絞って20件取得する。本文はD1から読み直し、利用者・キャラ・会話・元発言のhash・本文のhash・有効期間を再確認する。再生成では指定ターン以降の記憶も除く。Vectorizeに削除済み・編集前の結果が残っても、その本文をモデルへ渡さない。

順位は `類似度 × 重要度 × 2^(-経過日数/30)`。その順に最大8件を、見出しとIDを含めた2,000文字以内へ丸ごと収める。途中で切った事実は使わない。LangGraphは毎ターン再検索し、参考データをhuman messageへJSONとして渡す。上位のsystem instructionにはしない。実際に渡したIDと本文は既存のgeneration.request_jsonに残る。

## 有効化の境界

通常のローカル設定は`V2_RAG_ENABLED=0`。AIとVectorizeにはローカル模擬環境がないため、`env.rag`だけにremote bindingを宣言している。この環境の起動・デプロイは外部リソースへ接続する。テストはローカルD1と差し替えたbindingで実行し、この環境は起動しない。

本番接続には承認済みのD1・Queue・Vectorizeが必要。現在のD1 IDは既存のローカル用値であり、本番設定ではない。Vectorizeは1024次元・cosine、`kind`と`conversation_id`のstring metadata indexを投入前に用意する。本変更でリソース作成、実API呼出し、デプロイは行わない。

## この経路だけでは満たさない項目

- 固定vectorのテストは配線と境界の検査であり、意味の近い言い換えが上位3件へ入る品質検証ではない。
- 手入力記憶はRAG検索結果より先に同じ文脈予算へ統合する。明示編集した自動抽出記憶は元発言との自動有効性連携を外すが、矛盾する新旧事実の意味的な自動置換（RIT-86）や世界線・記憶版の管理は未実装。
- 古いvectorの物理削除と派生要約からの削除（RIT-94）、二段要約（RIT-72）は未接続。検索時の除外だけで削除完了とは扱わない。

参照: [bge-m3](https://developers.cloudflare.com/workers-ai/models/bge-m3/)、[Vectorize API](https://developers.cloudflare.com/vectorize/reference/client-api/)、[metadata index](https://developers.cloudflare.com/vectorize/reference/metadata-filtering/)、[bindingのローカル対応](https://developers.cloudflare.com/workers/local-development/bindings-per-env/)。
