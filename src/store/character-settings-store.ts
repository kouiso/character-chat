import { create } from "zustand";
import {
  createJSONStorage,
  persist,
  type PersistStorage,
  type StorageValue,
} from "zustand/middleware";

import { useSettingsStore, type ResponseLength } from "@/store/settings-store";

// この子との設定（設計 D-7）: 返事のかたち（長さ・写真頻度・文章のみ）を
// 全キャラ共通ではなく「このキャラだけ」に効かせる。キャラ単位で保存する。

export interface CharacterSettings {
  // null = 全体設定（グローバル）を継承
  responseLength: ResponseLength | null;
  // 会話に写真を混ぜる（向こうから送ってくる）。null = 全体設定を継承
  photoMix: boolean | null;
  // 頻度 0（ひかえめ）〜1（バンバン）。返事1回あたり写真が付く割合。
  photoFrequency: number;
  // 文章のみモード（画像を止める）
  textOnly: boolean;
}

// photoFrequency の既定が 1 なのは、スライダーが誰にも読まれてへんかった間
// 実際には「返事のたびに毎回」生成されとったから。0.5 のまま繋ぐと、一度も
// 触ってへん人の写真が黙って半分になる。今の実挙動を既定にして、下げたい人だけが
// スライダーを動かす形にする。
export const DEFAULT_CHARACTER_SETTINGS: CharacterSettings = {
  responseLength: null,
  photoMix: null,
  photoFrequency: 1,
  textOnly: false,
};

// 返事1回ごとに引く。roll は呼び出し側から渡して、判定そのものは決定的に保つ。
export const shouldAttachAutoPhoto = (enabled: boolean, frequency: number, roll: number): boolean =>
  enabled && roll < frequency;

// 全体設定のうち、この子との設定が上書きしうる分だけ
export interface GlobalReplySettings {
  responseLength: ResponseLength;
  autoGenerateImages: boolean;
}

export type ResolvedCharacterSettings = {
  [K in keyof CharacterSettings]: NonNullable<CharacterSettings[K]>;
};

// 触られた項目だけが全体設定に勝つ。キャラ側の既定値を勝たせると、一度も設定して
// いない子で全体設定（写真を自動で届ける／返事の長さ）が黙って無視される。
export const resolveCharacterSettings = (
  overrides: Partial<CharacterSettings> | undefined,
  global: GlobalReplySettings,
): ResolvedCharacterSettings => ({
  responseLength: overrides?.responseLength ?? global.responseLength,
  photoMix: overrides?.photoMix ?? global.autoGenerateImages,
  photoFrequency: overrides?.photoFrequency ?? DEFAULT_CHARACTER_SETTINGS.photoFrequency,
  textOnly: overrides?.textOnly ?? DEFAULT_CHARACTER_SETTINGS.textOnly,
});

// v1 = この子との設定が送信経路に届くようになった版。v1 未満で保存された値は
// 例外なく「シートが書くだけで誰も読んでいなかった」時期のもので、ユーザーは
// その効果を一度も見ていない。しかも当時のシートは photoMix の既定を true として
// 表示しとったので、全体設定 OFF の子でもトグルは ON に見えとった。つまり残った
// boolean は「この子は写真を止めたい」という意思の証拠にならん。今まで実際に効いて
// いたのは全体設定だけなので、捨てて継承へ戻すのが体感を変えん唯一の選択になる。
// 保存されとる値だけからは「本気で決めた」と「無反応なUIを触っただけ」を区別でける
// 材料が無い（時刻もフラグも持っとらん）。区別できるのは version だけで、それは
// 「v1 未満は全部 pre-fix」としか言えん。
export const CHARACTER_SETTINGS_STORAGE_VERSION = 1;

// 併せて、削除済みの receiveVideo など旧フィールドの残骸もここで消える。
//
// version を見ずに捨てると、次に version を上げた時（別件のスキーマ変更でも）
// 修正後に正しく効いとった設定まで巻き添えで消える。zustand は version が
// 食い違えば必ず migrate を呼び、返り値をそのまま保存し直すので取り返しがつかん。
// 捨てるのは「シートが無反応やった頃」= v1 未満だけに限る。
export const migrateCharacterSettings = (
  persisted: unknown,
  version: number,
): PersistedCharacterSettings =>
  version < CHARACTER_SETTINGS_STORAGE_VERSION
    ? { byCharacter: {} }
    : (persisted as PersistedCharacterSettings);

interface PersistedCharacterSettings {
  byCharacter: Record<string, Partial<CharacterSettings>>;
}

// version 未指定で保存された頃の値には version キー自体が無い（zustand は
// undefined を JSON へ落とす）。persist は `typeof version === "number"` の時しか
// migrate を呼ばんので、素通しやと旧データが現行 shape として採用されてしまう。
// 読み出し時に 0 を補って、migrate の対象に入れる。
const stampMissingVersion = (
  stored: StorageValue<PersistedCharacterSettings> | null,
): StorageValue<PersistedCharacterSettings> | null => {
  if (!stored) return stored;
  return typeof stored.version === "number" ? stored : { ...stored, version: 0 };
};

const createVersionedStorage = (): PersistStorage<PersistedCharacterSettings> | undefined => {
  const json = createJSONStorage<PersistedCharacterSettings>(() => localStorage);
  if (!json) return undefined;
  return {
    ...json,
    getItem: (name) => {
      const stored = json.getItem(name);
      return stored instanceof Promise
        ? stored.then(stampMissingVersion)
        : stampMissingVersion(stored);
    },
  };
};

interface CharacterSettingsState {
  byCharacter: Record<string, Partial<CharacterSettings>>;
  get: (characterId: string) => CharacterSettings;
  patch: (characterId: string, patch: Partial<CharacterSettings>) => void;
  reset: (characterId: string) => void;
}

export const useCharacterSettingsStore = create<CharacterSettingsState>()(
  persist(
    (set, getState) => ({
      byCharacter: {},
      get: (characterId) => ({
        ...DEFAULT_CHARACTER_SETTINGS,
        ...(getState().byCharacter[characterId] ?? {}),
      }),
      patch: (characterId, patch) =>
        set((state) => ({
          byCharacter: {
            ...state.byCharacter,
            [characterId]: { ...state.byCharacter[characterId], ...patch },
          },
        })),
      reset: (characterId) =>
        set((state) => {
          const next = { ...state.byCharacter };
          delete next[characterId];
          return { byCharacter: next };
        }),
    }),
    {
      name: "ou-character-settings",
      storage: createVersionedStorage(),
      partialize: (state) => ({ byCharacter: state.byCharacter }),
      version: CHARACTER_SETTINGS_STORAGE_VERSION,
      migrate: migrateCharacterSettings,
    },
  ),
);

// 送信経路が実際に使う値。「この子との設定」シートは保存だけして誰も読んでおらず、
// トグルが無反応やった（バグ報告 B6）。取得元をここへ寄せる。
export const useReplySettings = (
  characterId: string | null,
): { responseLength: ResponseLength; autoGenerateImages: boolean; photoFrequency: number } => {
  const globalResponseLength = useSettingsStore((s) => s.responseLength);
  const globalAutoGenerateImages = useSettingsStore((s) => s.autoGenerateImages);
  // セレクタで新規オブジェクトを返すと無限再描画になるため、生スライスを取る
  const overrides = useCharacterSettingsStore((s) =>
    characterId ? s.byCharacter[characterId] : undefined,
  );
  const resolved = resolveCharacterSettings(overrides, {
    responseLength: globalResponseLength,
    autoGenerateImages: globalAutoGenerateImages,
  });
  return {
    responseLength: resolved.responseLength,
    // 文章のみモードは「画像を止める」側なので、写真を混ぜる設定より強い
    autoGenerateImages: resolved.photoMix && !resolved.textOnly,
    photoFrequency: resolved.photoFrequency,
  };
};
