/**
 * 衣装タグ語彙（src/schema/outfit-tag-vocabulary.generated.ts）を生成する。
 *
 * 出典は danbooru のタグ一覧（名前 / カテゴリ / 投稿数）。画像モデル
 * waiNSFWIllustrious は danbooru のタグで学習されとるので、「danbooru に
 * そのタグが何枚あるか」がそのまま「モデルがその語を絵にできるか」の根拠になる。
 * 逆に投稿数ゼロの語（`top` / `uniform` / `outfit` / `accents`）は学習側に
 * 存在せんので、プロンプトへ流しても絵に出えへん。#923 の原因はここ。
 *
 * 実行: pnpm tsx scripts/generate-outfit-vocabulary.ts
 */
import { writeFileSync } from "node:fs";

const SOURCE_URL =
  "https://raw.githubusercontent.com/DominikDoom/a1111-sd-webui-tagcomplete/main/tags/danbooru.csv";
const OUTPUT_PATH = "src/schema/outfit-tag-vocabulary.generated.ts";

// danbooru の general カテゴリ。character / copyright / artist を語彙に混ぜん。
const GENERAL_CATEGORY = 0;

// 単体で衣装・装飾として成立する語。ここは「衣類か否か」の人間の判断が入るが、
// 各語が danbooru に実在するかどうかは下の attested フィルタが機械的に確かめる。
// `casual` のような「雰囲気」の語は入れん。danbooru に実在はするが、実生成 4 枚で
// 2 枚が下着同然のキャミソールになり、どの服になるかを決められんかった（#923 検証）。
// 修飾語としては残るので `casual_hoodie` は通る。
const HEAD_CANDIDATES = [
  "shirt",
  "blouse",
  "camisole",
  "tank_top",
  "crop_top",
  "tube_top",
  "halterneck",
  "sweater",
  "turtleneck",
  "hoodie",
  "cardigan",
  "jacket",
  "blazer",
  "coat",
  "raincoat",
  "vest",
  "waistcoat",
  "dress",
  "sundress",
  "gown",
  "nightgown",
  "kimono",
  "yukata",
  "hakama",
  "haori",
  "obi",
  "china_dress",
  "skirt",
  "miniskirt",
  "pleated_skirt",
  "pencil_skirt",
  "shorts",
  "pants",
  "jeans",
  "leggings",
  "overalls",
  "bodysuit",
  "leotard",
  "swimsuit",
  "bikini",
  "school_uniform",
  "serafuku",
  "sailor_collar",
  "military_uniform",
  "police_uniform",
  "maid_headdress",
  "gym_uniform",
  "volleyball_uniform",
  "nurse",
  "apron",
  "maid",
  "pajamas",
  "robe",
  "cape",
  "cloak",
  "poncho",
  "armor",
  "suit",
  "business_suit",
  "necktie",
  "bowtie",
  "ribbon",
  "bow",
  "choker",
  "collar",
  "necklace",
  "earrings",
  "piercing",
  "ear_piercing",
  "jewelry",
  "bracelet",
  "ring",
  "glasses",
  "sunglasses",
  "hat",
  "beanie",
  "beret",
  "witch_hat",
  "hood",
  "headband",
  "hairband",
  "hairclip",
  "hair_ornament",
  "scarf",
  "shawl",
  "belt",
  "sash",
  "gloves",
  "thighhighs",
  "pantyhose",
  "socks",
  "kneehighs",
  "boots",
  "high_heels",
  "shoes",
  "sandals",
  "sneakers",
  "corset",
  "garter_straps",
  "panties",
  "bra",
  "underwear",
  "lingerie",
  "kigurumi",
  "dougi",
  "frills",
  "lace",
  "detached_sleeves",
  "swimsuit_cover-up",
  "kappougi",
  "cheerleader",
  "track_jacket",
  "sportswear",
  "hair_bow",
  "hair_ribbon",
  "hairpin",
  "veil",
  "mask",
  "headphones",
  "backpack",
  "bag",
  "baseball_cap",
] as const;

// 複合タグを語彙へ入れる下限。これ未満はモデルが安定して描けん。
const COMPOUND_MIN_POST_COUNT = 30_000;
// 修飾語の採用条件。複数の衣装タグの先頭に付いて、合計投稿数がこの値を超えること。
const MODIFIER_MIN_HEAD_VARIETY = 2;
const MODIFIER_MIN_POST_COUNT = 3_000;
// 上の機械条件では拾えんが danbooru に実在する一般的な修飾語。値は代表タグの投稿数。
const EXTRA_MODIFIERS: Record<string, number> = {
  dark: 285_606, // dark_skin
  light: 73_806, // light_smile
  pale: 53_109, // pale_skin
  formal: 69_235, // formal_clothes
  summer: 21_729, // summer_uniform
  gothic: 17_715, // gothic_lolita
  oversized: 12_594, // oversized_clothes
  casual: 12_574, // casual_one-piece_swimsuit
  silver: 1_571, // silver_trim
};

type DanbooruTag = { name: string; category: number; postCount: number; aliases: string[] };

const parseCsv = (csv: string): DanbooruTag[] => {
  const tags: DanbooruTag[] = [];
  for (const line of csv.split("\n")) {
    if (line.trim() === "") continue;
    const matched = /^([^,]+),(\d+),(\d+)(?:,(.*))?$/.exec(line);
    if (matched === null) continue;
    const rawAliases = (matched[4] ?? "").replace(/^"|"$/g, "");
    tags.push({
      name: matched[1],
      category: Number(matched[2]),
      postCount: Number(matched[3]),
      aliases:
        rawAliases === ""
          ? []
          : rawAliases
              .split(",")
              .map((a) => a.trim())
              .filter(Boolean),
    });
  }
  return tags;
};

// 末尾から最長 3 語まで見て、語彙に在る主辞を探す。`white_tank_top` は `tank_top`。
const findHead = (name: string, heads: ReadonlySet<string>): string | null => {
  const parts = name.split("_");
  for (let size = Math.min(3, parts.length); size >= 1; size -= 1) {
    const candidate = parts.slice(parts.length - size).join("_");
    if (heads.has(candidate)) return candidate;
  }
  return null;
};

const main = async (): Promise<void> => {
  const response = await fetch(SOURCE_URL, {
    headers: { "User-Agent": "adult-ai-app/outfit-vocab" },
  });
  if (!response.ok) throw new Error(`danbooru tag list fetch failed: ${response.status}`);
  const tags = parseCsv(await response.text());
  const byName = new Map(tags.map((t) => [t.name, t]));

  const heads = new Set(
    HEAD_CANDIDATES.filter((h) => byName.get(h)?.category === GENERAL_CATEGORY),
  );
  const unattestedHeads = HEAD_CANDIDATES.filter((h) => !heads.has(h));

  const vocabulary = new Map<string, number>();
  for (const head of heads) vocabulary.set(head, byName.get(head).postCount);
  for (const tag of tags) {
    if (tag.category !== GENERAL_CATEGORY) continue;
    if (tag.postCount < COMPOUND_MIN_POST_COUNT) continue;
    if (!tag.name.includes("_")) continue;
    if (findHead(tag.name, heads) === null) continue;
    vocabulary.set(tag.name, tag.postCount);
  }

  const modifierStat = new Map<string, { heads: Set<string>; total: number }>();
  for (const tag of tags) {
    if (tag.category !== GENERAL_CATEGORY || tag.postCount < 300 || !tag.name.includes("_"))
      continue;
    const head = findHead(tag.name, heads);
    if (head === null) continue;
    const parts = tag.name.split("_");
    const leading = parts.slice(0, parts.length - head.split("_").length);
    for (const modifier of leading) {
      const entry = modifierStat.get(modifier) ?? { heads: new Set<string>(), total: 0 };
      entry.heads.add(head);
      entry.total += tag.postCount;
      modifierStat.set(modifier, entry);
    }
  }
  const modifiers = new Map<string, number>(Object.entries(EXTRA_MODIFIERS));
  for (const [name, stat] of modifierStat) {
    if (stat.heads.size < MODIFIER_MIN_HEAD_VARIETY) continue;
    if (stat.total < MODIFIER_MIN_POST_COUNT) continue;
    modifiers.set(name, stat.total);
  }

  // danbooru 自身が持つ別名だけを採る。こちらで同義語を推測して足さん。
  const aliases = new Map<string, string>();
  for (const tag of tags) {
    if (!vocabulary.has(tag.name)) continue;
    for (const alias of tag.aliases) {
      if (vocabulary.has(alias) || aliases.has(alias)) continue;
      if (!/^[a-z0-9_'-]+$/.test(alias)) continue;
      aliases.set(alias, tag.name);
    }
  }

  const record = (entries: Iterable<[string, number | string]>): string =>
    [...entries]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => `  ${JSON.stringify(k)}: ${typeof v === "number" ? v : JSON.stringify(v)},`)
      .join("\n");

  const file = `// 自動生成ファイル。手で編集せん。
// 生成: pnpm tsx scripts/generate-outfit-vocabulary.ts
// 出典: ${SOURCE_URL}
// 取得日: ${new Date().toISOString().slice(0, 10)}
// 値は danbooru の投稿数。学習コーパスでの出現量がそのまま「絵に出るか」の根拠になる。

export const OUTFIT_TAG_POST_COUNT: Readonly<Record<string, number>> = {
${record(vocabulary)}
};

export const OUTFIT_MODIFIER_POST_COUNT: Readonly<Record<string, number>> = {
${record(modifiers)}
};

// danbooru が公式に持つ別名 → 正式タグ。
export const DANBOORU_TAG_ALIASES: Readonly<Record<string, string>> = {
${record(aliases)}
};
`;
  writeFileSync(OUTPUT_PATH, file);
  console.log(
    `wrote ${OUTPUT_PATH}: vocabulary=${vocabulary.size} modifiers=${modifiers.size} aliases=${aliases.size}`,
  );
  if (unattestedHeads.length > 0) {
    console.log(`danbooru に存在せんかった主辞候補: ${unattestedHeads.join(", ")}`);
  }
};

await main();
