import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// .dev.varsからNOVITA_API_KEYを取得
const devVars = readFileSync(join(import.meta.dirname, "..", ".dev.vars"), "utf-8");
const apiKeyMatch = devVars.match(/NOVITA_API_KEY=(.+)/);
if (!apiKeyMatch) throw new Error("NOVITA_API_KEY not found in .dev.vars");
const NOVITA_API_KEY = apiKeyMatch[1].trim();

const AVATARS_DIR = join(import.meta.dirname, "..", "public", "avatars");

// キャラIDと外見描写のマッピング
// systemPromptの日本語記述から英語のanime portrait promptに変換済み
const CHARACTER_PROMPTS: Record<string, string> = {
  "char-mitsuki":
    "1girl, bartender, age 24, long black hair, mature woman, open chest white shirt, black vest, alluring smile, bar counter background, warm lighting",
  "char-rinka":
    "1girl, college student, age 20, glasses, brown hair in ponytail, innocent look, white blouse, cardigan, university library background, soft lighting",
  "char-azusa":
    "1girl, female doctor, age 28, short black hair, cool expression, white lab coat, stethoscope, hospital office background, professional lighting",
  "char-hikari":
    "1girl, maid, age 22, twin tails, pink hair, mischievous smile, frilly maid outfit, black and white dress, cafe background, bright lighting",
  "char-saya":
    "1girl, married woman, age 32, gentle expression, long brown hair, apron over casual dress, kitchen background, warm domestic lighting",
  "char-reina":
    "1girl, dominatrix, age 26, long silver hair, sharp red eyes, confident smirk, black leather outfit, choker, dark room background, dramatic lighting",
  "char-suzu":
    "1girl, maid, age 19, short blue hair, shy expression, classic maid uniform, headband, mansion interior background, gentle lighting",
  "char-yuno":
    "1girl, yandere, age 21, long pink hair, obsessive loving eyes, school uniform with cardigan, bedroom background, dim lighting",
  "char-tsukasa":
    "1girl, office worker, age 23, short brown hair, tsundere expression, business suit, glasses pushed up, office background, fluorescent lighting",
  "char-mamiko":
    "1girl, maternal figure, age 35, long wavy brown hair, warm gentle smile, loose sweater, living room background, cozy warm lighting",
  "char-ran":
    "1girl, gyaru, age 20, blonde hair with highlights, tanned skin, bright smile, crop top, accessories, city night background, neon lighting",
  "char-lilith":
    "1girl, succubus, demon horns, long purple hair, seductive red eyes, revealing dark dress, bat wings, fantasy dark castle background, moonlight",
  "char-kaori":
    "1girl, teacher, age 29, glasses, brown hair in bun, strict expression, white blouse, tight pencil skirt, classroom background, afternoon light",
  "char-chihaya":
    "1girl, shrine maiden, age 22, long black hair, traditional miko outfit, white haori and red hakama, shrine background, serene lighting",
  "char-akane":
    "1girl, sporty girl, age 24, short red hair, tanned skin, confident grin, sports bra, athletic build, gym background, bright lighting",
  "char-shizuku":
    "1girl, widow, age 30, long black hair, melancholic expression, black mourning dress, elegant, traditional Japanese room, dim candle lighting",
  "char-mei":
    "1girl, counselor, age 27, medium purple hair, mysterious smile, professional blazer, hypnotic spiral eyes, therapy room background, soft lighting",
  "char-mao":
    "1girl, seductress, age 25, short black bob hair, bold expression, tight red dress, elevator interior background, dramatic close-up lighting",
  "char-natsumi":
    "1girl, office lady, age 26, long brown hair, elegant, black stockings focus, pencil skirt, office desk background, warm lighting",
  "char-koharu":
    "1girl, perfumer, age 23, wavy light brown hair, dreamy expression, floral dress, surrounded by perfume bottles, boutique background, golden lighting",
  "char-rio":
    "1girl, gravure model, age 22, long blonde hair, playful wink, swimsuit, outdoor park background, bright sunlight",
  "char-miku":
    "1girl, cosplayer, age 21, multicolor hair, excited expression, elaborate costume, convention hall background, colorful lighting",
  "char-noir":
    "1girl, vampire, age unknown, long white hair, red eyes, gothic lolita dress, fangs visible, dark castle interior, moonlight through window",
  "char-alice":
    "1girl, ojou-sama, age 18, long blonde curly hair, innocent wide eyes, white lace dress, rose garden background, soft romantic lighting",
  "char-sora":
    "1girl, twin sister elder, age 20, medium blue hair, confident expression, matching outfit with ribbon, bedroom background, natural lighting",
  "char-umi":
    "1girl, twin sister younger, age 20, medium blue hair, shy expression, matching outfit with different ribbon, bedroom background, natural lighting",
  "char-sumire":
    "1girl, female boss, age 34, short dark hair, stern expression, power suit, high heels, executive office background, cold lighting",
  "char-tsubaki":
    "1girl, rope artist, age 28, long black hair with red highlights, calm artistic expression, traditional kimono loosely worn, tatami room, warm lighting",
  "char-kirara":
    "1girl, VTuber streamer, age 21, long pink twintails, starry eyes, cute idol outfit with headset, streaming room with monitors, RGB lighting",
  "char-hinata":
    "1girl, nurse, age 25, short orange hair, caring smile, white nurse uniform, hospital room background, clinical lighting",
  "char-kanon":
    "1girl, step-sister, age 23, long light brown hair, slightly embarrassed expression, oversized t-shirt, home interior background, morning light",
  "char-risa":
    "1girl, escort, age 26, glamorous, long wavy black hair, beautiful makeup, elegant black dress, luxury hotel lobby background, ambient lighting",
  "char-sieglinde":
    "1girl, female knight, age 24, muscular build, long blonde braided hair, armor partially removed, medieval castle background, torch lighting",
  "char-tama":
    "1girl, catgirl, age 19, cat ears, short orange hair, playful expression, oversized sweater, tail visible, cozy room background, warm lighting",
  "char-sayoko":
    "1girl, mature woman, age 50, elegant grey-streaked black hair in updo, calm composed expression, traditional kimono, calligraphy room, soft lighting",
  "char-iris":
    "1girl, android, age unknown, short silver hair, LED blue eyes, minimal expression, white bodysuit with circuit patterns, sci-fi lab background, blue lighting",
  "char-valkyrie":
    "1girl, female knight, age 26, long blonde braided hair, stern silver eyes, muscular build, silver armor partially removed, red cape, medieval castle background, torch lighting",
  "char-yuurei":
    "1girl, ghost girl, age unknown, long straight black hair covering face, hollow pale eyes, tattered white dress, semi-transparent body, dark apartment room, eerie blueish light",
  "char-nagisa":
    "1girl, girlfriend, age 22, medium brown hair, gentle loving expression, casual sundress, park bench background, golden hour lighting",
  "char-aoi":
    "1girl, news anchor, age 27, styled black bob hair, professional smile, elegant blouse, TV studio background, studio lighting",
  "char-madoka":
    "1girl, fortune teller, age 25, long wavy dark purple hair, mysterious expression, flowing robe with stars, crystal ball, dimly lit tent, candlelight",
  "char-ushirokono":
    "1girl, ghost girl, age unknown, long pale white hair, hollow dark eyes, tattered white dress, dark apartment room, eerie blue-white lighting",
  "char-aelindra-elf":
    "1girl, solo, long silver hair, glowing pale skin, long elf ears, ethereal white dress, forest onsen bathing, moonlight, fantasy, beautiful, 20s appearance, slightly glowing",
  "char-airi-ai":
    "1girl, solo, short silver hair, circuit pattern on skin, futuristic minimal dress, wide curious eyes, soft glow, android aesthetics, age 22 appearance",
  "char-aki-imouto":
    "1girl, solo, short brown hair, round eyes, pajamas, slightly teary eyes, home room late night, emotional, bittersweet, 21 years old, younger sister type",
  "char-elena-coach":
    "1girl, solo, long blonde hair half-up, blue eyes, tall slender, riding coat, equestrian outfit, stable at night, athletic european woman, 24 years old",
  "char-hinata-nurse":
    "1girl, solo, nurse uniform, nurse cap, white stockings, bright smile, energetic, ponytail, age 25, hospital ward at night, stethoscope, cheerful nurse",
  "char-kaede":
    "1girl, solo, long black hair loosely gathered, almond eyes, soft expression, white esthetician uniform, massage table, treatment room, warm lighting, age 27, voluptuous figure, gentle hands, professional spa",
  "char-kaho":
    "1girl, solo, short black hair undercut, tan skin, athletic toned body, visible abs, sports bra, training pants, gym, energetic expression, 21 years old",
  "char-koharu-ex":
    "1girl, solo, chestnut shoulder-length hair, subtle makeup, wedding ring, hotel bar setting, dim lighting, adult elegance, nostalgic mood, 29 years old, ex-girlfriend",
  "char-konkon-fox":
    "1girl, solo, orange fox ears and tail, long red orange hair, amber eyes, modified shrine maiden outfit, ancient shrine at night, moonlight, mischievous smile, foxgirl, adult appearance",
  "char-luna-isekai":
    "1girl, solo, twin braids, apron dress, medieval fantasy inn keeper, bright eyes, candle light, stone room attic, cheerful, adult appearance, fantasy setting",
  "char-mei-yokyo":
    "1girl, solo, short wavy brown hair, dimples, school uniform, rooftop storage room, cheerful and nervous, curious expression, 18 years old",
  "char-mihoko-omanko":
    "1girl, solo, elegant adult private tutor, 27 years old, neat short black hair, thin glasses, formal white blouse, dark pencil skirt, tutoring room with study desk and textbooks, composed mature smile, refined teacher aura, warm evening lamp light",
  "char-misaki-ntr":
    "1girl, solo, long black hair, natural makeup, casual home wear, living room at night, complex emotional confession expression, 24 years old",
  "char-nazuna-renzoku":
    "1girl, solo, adult massage therapist, 24 years old, short sporty dark hair, clean spa therapist uniform, gentle hands visible near massage table, calm professional expression, private hotel spa room, folded towels, warm soft lighting",
  "char-rika-kotoba":
    "1girl, solo, black thin-framed glasses, black bob hair, professional blouse, research office, bookshelves, sharp intelligent eyes, slim figure, 35 years old",
  "char-runa-wolf":
    "1girl, solo, white wolf ears and tail, silver grey hair, golden eyes, fur trim clothing, snowy mountain cabin, firelight, light blush, beastgirl, adult appearance",
  "char-sena":
    "1girl, solo, tanned skin, athletic toned body, competitive swimsuit tan line, short wet hair, bright smile, age 22, swim coach, pool changing room, sporty energetic expression",
  "char-shion-ohogoe":
    "1girl, solo, long silver hair tied with ribbon, large soft eyes, recording booth, headphones around neck, voice actress, expressive face, age 22, microphone in front",
  "char-shiori-boss":
    "1girl, solo, mature female boss, 34 years old, black shoulder-length hair, red lips, sharp tired eyes, black business suit jacket slipped off shoulders, silk blouse, luxury hotel bar counter, whiskey glass, dim amber lighting, powerful executive aura",
  "char-suzune-kyudo":
    "1girl, solo, black long hair tied back, traditional japanese archery uniform keikogi hakama, tall slender, earnest eyes, japanese archery dojo, sunset light, age 18",
  "char-touka":
    "1girl, solo, dark brown shoulder-length hair, elegant adult woman, yukata, japanese inn, moonlight, garden view, soft smile, 26 years old",
  "char-tsumugi":
    "1girl, solo, brown long hair loose, glasses, home wear, warm room, cohabiting girlfriend look, soft tired eyes, familiar atmosphere, 25 years old",
  "char-yui":
    "1girl, solo, long wavy brown hair, cat-like eyes, small frame, oversized pajamas, late night bedroom, sleepy expression, clingy atmosphere, 21 years old",
  "char-yuzuki":
    "1girl, solo, long straight hair low ponytail, thin-framed glasses, fair skin, slender figure, modest blouse and skirt, library, morning sunlight, age 25, gentle quiet beauty, bookshelf background",
  "char-zerafina-mao":
    "1girl, solo, long black hair, pale skin, purple glowing eyes, dark mage outfit, chains on wrists, dungeon setting, gothic atmosphere, 20s appearance, captive but proud",
  "char-sakura":
    "1girl, solo, japanese university student, age 20, straight medium dark brown hair, fair complexion, soft shy eyes, natural makeup, modest casual dress, white cardigan, evening apartment room background, gentle pure atmosphere, shy smile",
  "import-charap-downer-oneesan":
    "1girl, solo, long dark hair, sleepy half-lidded eyes, oversized cardigan, relaxed posture, small apartment room, late night warm light, mature downer woman, age 24 appearance",
  "import-charap-kara-maid":
    "1girl, solo, navy blue hair, tired gentle eyes, classic maid uniform, quiet mansion hallway, subdued lighting, composed expression, adult maid, age 22 appearance",
  "import-charap-kogane":
    "1girl, solo, cheerful adult woman, short honey brown hair, casual jacket, coin purse, small izakaya table, unlucky gambler mood, bright grin, age 25 appearance",
  "import-charap-misaki-ikeda":
    "1girl, solo, mature married woman, age 38, tall curvy figure, long dark hair, soft lonely expression, elegant casual blouse, evening living room, warm domestic lighting",
  "import-charap-night-bus-oneesan":
    "1girl, solo, calm mature woman, shoulder length brown hair, coat and scarf, night bus seat, dim blue cabin light, gentle smile, adult oneesan, age 28 appearance",
  "import-charap-pregnancy-commotion":
    "1girl, solo, adult childhood friend, long chestnut hair, apron over casual clothes, shared house kitchen, lively romantic comedy mood, bright expression, age 24 appearance",
  "import-charap-text-game-nsfw":
    "1girl, solo, game master woman, long black hair, headset microphone, tablet in hand, neon command room, playful mysterious smile, adult narrator, age 25 appearance",
  "import-charap-yuka-tutor":
    "1girl, solo, private tutor, long brown hair, glasses, cardigan over blouse, study desk, textbooks, close gentle smile, adult teacher, age 27 appearance",
  "import-saylo-haruna-wife":
    "1girl, solo, young wife, age 23, kindergarten teacher, soft brown hair, apron over casual cardigan, warm home kitchen, expressive smile, kansai cheerful mood",
  "import-saylo-kumi-campus":
    "1girl, solo, university junior, short dark brown hair, casual campus outfit, izakaya table after drinking party, reserved but kind expression, age 21 appearance",
};

const COMMON_PREFIX =
  "masterpiece, best quality, anime style, 1girl, portrait, face focus, upper body, looking at viewer, detailed face, beautiful eyes, ";
const COMMON_NEGATIVE =
  "worst quality, low quality, normal quality, lowres, bad anatomy, bad hands, extra fingers, missing fingers, text, watermark, signature, blurry, realistic, photorealistic, 3d, western, multiple girls, nsfw, nude, nipples";

const initTask = async (prompt: string): Promise<string> => {
  const res = await fetch("https://api.novita.ai/v3/async/txt2img", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOVITA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      extra: { response_image_type: "jpeg" },
      request: {
        model_name: "meinahentai_v4_70340.safetensors",
        prompt: COMMON_PREFIX + prompt,
        negative_prompt: COMMON_NEGATIVE,
        width: 512,
        height: 512,
        sampler_name: "DPM++ 2M Karras",
        steps: 28,
        guidance_scale: 7,
        image_num: 1,
        seed: -1,
      },
    }),
  });
  if (!res.ok) throw new Error(`Novita init failed: ${res.status} ${await res.text()}`);
  const json: unknown = await res.json();
  // Novita APIは必ずtask_idを返すが、ランタイム検証する
  if (
    typeof json !== "object" ||
    json === null ||
    !("task_id" in json) ||
    typeof json.task_id !== "string"
  ) {
    throw new Error("Novita init: task_id not found in response");
  }
  return json.task_id;
};

// ポーリング1回分の結果: 画像URL取得成功 / まだ処理中 / 失敗
type PollResult = { done: true; imageUrl: string } | { done: false };

// Novita APIのタスク結果レスポンス型
interface NovitaTaskResult {
  task?: { status: string };
  images?: { image_url?: string }[];
}

// unknown JSONをNovitaTaskResult互換として安全に扱うガード
const isNovitaTaskResult = (v: unknown): v is NovitaTaskResult =>
  typeof v === "object" && v !== null;

const checkTaskResult = async (taskId: string): Promise<PollResult> => {
  const res = await fetch(
    `https://api.novita.ai/v3/async/task-result?task_id=${encodeURIComponent(taskId)}`,
    { headers: { Authorization: `Bearer ${NOVITA_API_KEY}` } },
  );
  if (!res.ok) throw new Error(`Novita poll failed: ${res.status}`);
  const raw: unknown = await res.json();
  if (!isNovitaTaskResult(raw)) throw new Error("Novita poll: unexpected response shape");
  if (raw.task?.status === "TASK_STATUS_SUCCEED") {
    const imageUrl = raw.images?.[0]?.image_url;
    if (!imageUrl) throw new Error("No image URL in response");
    return { done: true, imageUrl };
  }
  if (raw.task?.status === "TASK_STATUS_FAILED") {
    throw new Error(`Task failed: ${JSON.stringify(raw.task)}`);
  }
  return { done: false };
};

const pollTask = async (taskId: string, maxAttempts = 60): Promise<string> => {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const result = await checkTaskResult(taskId);
    if (result.done) return result.imageUrl;
    process.stdout.write(".");
  }
  throw new Error(`Task ${taskId} timed out after ${maxAttempts * 3}s`);
};

const downloadImage = async (url: string, destPath: string): Promise<void> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buffer);
};

const main = async () => {
  const force = process.argv.includes("--force");
  const requestedIds = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const requestedIdSet = new Set(requestedIds);
  const entries = Object.entries(CHARACTER_PROMPTS).filter(
    ([id]) => requestedIdSet.size === 0 || requestedIdSet.has(id),
  );
  const unknownIds = requestedIds.filter((id) => !(id in CHARACTER_PROMPTS));
  if (unknownIds.length > 0) {
    throw new Error(`Unknown avatar id(s): ${unknownIds.join(", ")}`);
  }
  console.info(`\n🎨 Generating ${entries.length} character avatars...\n`);

  // 既に生成済みのキャラはスキップ
  const pending = entries.filter(([id]) => {
    const path = join(AVATARS_DIR, `${id}.jpg`);
    if (!force && existsSync(path)) {
      console.info(`⏭  ${id} — already exists, skipping`);
      return false;
    }
    return true;
  });

  if (pending.length === 0) {
    console.info("\n✅ All avatars already generated!");
    return;
  }

  console.info(`\n📦 ${pending.length} avatars to generate\n`);

  // Novita APIのレート制限を考慮して3並列で処理
  const CONCURRENCY = 3;
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ([id, prompt]) => {
        try {
          process.stdout.write(`🖌  ${id}: initiating...`);
          const taskId = await initTask(prompt);
          process.stdout.write(` task=${taskId.slice(0, 8)}... polling`);
          const imageUrl = await pollTask(taskId);
          const destPath = join(AVATARS_DIR, `${id}.jpg`);
          await downloadImage(imageUrl, destPath);
          console.info(`\n✅ ${id}: saved to ${destPath}`);
        } catch (error) {
          console.error(`\n❌ ${id}: ${error instanceof Error ? error.message : error}`);
        }
      }),
    );
  }

  console.info("\n🎉 Avatar generation complete!");
  console.info("Next steps:");
  console.info("  1. Run: pnpm db:seed:reset  (avatars will be linked automatically)");
};

main().catch(console.error);
