-- #923 本番 character_default_outfit_tag の是正（承認待ち・未実行）
-- 対象: 261 行 / 異なり 209。UPDATE 85 語(→行数は下記)、DELETE 56 語 = 62 行。
-- UPDATE OR REPLACE は PK(character_id, tag) が衝突したとき旧行を捨てる。

UPDATE OR REPLACE character_default_outfit_tag SET tag = 'swimsuit' WHERE tag = 'bare-shoulder_swimwear';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'coat' WHERE tag = 'beige_coat';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'black_dress' WHERE tag = 'black dress';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'black_formal_maid' WHERE tag = 'black_formal_maid_dress';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'black_ribbon_necktie' WHERE tag = 'black_ribbon_tie';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'black_serafuku' WHERE tag = 'black_sailor_uniform';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'black_sleeveless_china_dress' WHERE tag = 'black_sleeveless_qipao';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'black_thighhighs' WHERE tag = 'black_stockings';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'black_jacket' WHERE tag = 'black_street_jacket';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'black_jacket' WHERE tag = 'black_sukajan_jacket';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'blue_ribbon_necktie' WHERE tag = 'blue_ribbon_tie';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'witch_hat' WHERE tag = 'burgundy_witch_hat';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'hat' WHERE tag = 'cap';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'cardigan' WHERE tag = 'cardigans';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'vest' WHERE tag = 'corset_vest';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'coat' WHERE tag = 'cream_coat';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'turtleneck_sweater' WHERE tag = 'cream_turtleneck_sweater';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'jacket' WHERE tag = 'crop_jacket';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'crop_top' WHERE tag = 'cropped_top';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'dark_blazer' WHERE tag = 'dark_academy_blazer';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'dark_dress' WHERE tag = 'dark_fantasy_dress';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'dark_suit' WHERE tag = 'dark_fitted_suit';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'dark_school_collar' WHERE tag = 'dark_navy_school_style_collar';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'dark_blazer' WHERE tag = 'dark_university_style_blazer';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'ear_piercing' WHERE tag = 'ear_piercings';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'dark_dress' WHERE tag = 'elegant_dark_kimono_dress';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'blouse' WHERE tag = 'fantasy_tavern_b blouse';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'school_uniform' WHERE tag = 'fashionable_school_uniform';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'bodysuit' WHERE tag = 'futuristic_combat_bodysuit';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'suit' WHERE tag = 'futuristic_lunar_colony_combat_suit';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'gothic_maid' WHERE tag = 'gothic_maid_dress';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'blouse' WHERE tag = 'idol_b blouse';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'dress' WHERE tag = 'jirai-kei_dress';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'dougi' WHERE tag = 'karate_gi';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'kimono' WHERE tag = 'kimono_style_top';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'lace' WHERE tag = 'lace_headpiece';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'light_blouse' WHERE tag = 'light_b blouse';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'light_casual_blouse' WHERE tag = 'light_casual_b blouse';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'light_swimsuit_cover-up' WHERE tag = 'light_cover-up';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'light_school_blouse' WHERE tag = 'light_school_b blouse';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'light_school_jacket' WHERE tag = 'light_school_inspired_jacket';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'loose_cardigan' WHERE tag = 'loose_cream_cardigan';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'necktie' WHERE tag = 'loosened_tie';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'maid' WHERE tag = 'maid_dress';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'miniskirt' WHERE tag = 'mini_skirt';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'pajamas' WHERE tag = 'modest_pajamas';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'school_uniform' WHERE tag = 'modified_school_uniform';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'casual_school_cardigan' WHERE tag = 'navy_casual_school_cardigan';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'police_uniform' WHERE tag = 'navy_police_uniform';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'sailor_collar' WHERE tag = 'navy_sailor_style_collar';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'serafuku' WHERE tag = 'navy_sailor_uniform';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'school_uniform' WHERE tag = 'navy_school_uniform';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'skirt' WHERE tag = 'navy_skirt';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'dress' WHERE tag = 'neat_dress';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'skirt' WHERE tag = 'neat_skirt';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'off-shoulder_white_cardigan' WHERE tag = 'off-shoulder white cardigan';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'pink_collar' WHERE tag = 'pink_collar_trim';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'boots' WHERE tag = 'platform_boots';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'jewelry' WHERE tag = 'playful_jewelry';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'jacket' WHERE tag = 'punk_jacket';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'red_ribbon' WHERE tag = 'red ribbon';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'red_ribbon_necktie' WHERE tag = 'red_ribbon_tie';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'red_necktie' WHERE tag = 'red_tie';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'cardigan' WHERE tag = 'refined_campus_cardigan';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'ribbon_necktie' WHERE tag = 'ribbon_tie';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'blouse' WHERE tag = 'rumpled_office_b blouse';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'school_uniform' WHERE tag = 'rumpled_school_uniform';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'serafuku' WHERE tag = 'sailor_uniform';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'miniskirt' WHERE tag = 'short_skirt';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'silver_armor' WHERE tag = 'silver_plate_armor';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'blouse' WHERE tag = 'simple_blouse';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'blouse' WHERE tag = 'simple_office_b blouse';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'skirt' WHERE tag = 'skirts';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'cape' WHERE tag = 'small_cape';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'blouse' WHERE tag = 'stylish_date-night_b blouse';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'cardigan' WHERE tag = 'teacher_cardigan';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'tight_black_suit' WHERE tag = 'tight_black_spy_suit';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'bowtie' WHERE tag = 'turquoise_bow_tie';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'turtleneck_sweater' WHERE tag = 'turtleneck sweater';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'white_blue_dress' WHERE tag = 'white_and_blue_royal_dress';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'white_shirt' WHERE tag = 'white_blouse';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'white_nightgown' WHERE tag = 'white_nightdress';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'white_school_blouse' WHERE tag = 'white_school_b blouse';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'dress' WHERE tag = 'worn_simple_dress';
UPDATE OR REPLACE character_default_outfit_tag SET tag = 'yellow_ribbon_necktie' WHERE tag = 'yellow_ribbon_tie';
-- 語彙に一語も無く、今も絵に効いてへん値を落とす（62 行 / 41+ キャラ、うち 11 キャラは衣装が 0 件になる）。
DELETE FROM character_default_outfit_tag WHERE tag IN (
  'accessories',
  'athletic_top',
  'battle_worn',
  'beach_top',
  'black_off-shoulder_top',
  'casual',
  'casual_campus_clothes',
  'casual_campus_gyaru_clothes',
  'casual_clothes',
  'casual_date_outfit',
  'casual_top',
  'chain_accessories',
  'cheap_streetwear',
  'cropped_tops',
  'dark_casual_top',
  'dark_navy_high-collar_student_council_uniform',
  'dark_ninja_outfit',
  'dark_sailor_style_uniform',
  'family_crest',
  'fitted_top',
  'flashy_streetwear',
  'glowing',
  'glowing_tech_panels',
  'gold_trim',
  'gyaru_makeup',
  'heart_accessories',
  'high-collar_uniform',
  'light_casual_top',
  'loose_off-shoulder_top',
  'loose_oversized_roomwear',
  'low-cut_top',
  'manager_outfit',
  'modern_campus_outfit',
  'modern_casual',
  'navy_academy_uniform',
  'neat_cafe_date_outfit',
  'occult_accessories',
  'punk_accessories',
  'red_accents',
  'relaxed_homewear',
  'rose_accessories',
  'sci-fi_accessories',
  'silver_trim',
  'sleeveless_top',
  'small_bat_accessories',
  'soft_beige_knit_top',
  'soft_roomwear',
  'streetwear',
  'stylish_campus_outfit',
  'summer_beach_top',
  'tactical_straps',
  'trendy_accessories',
  'trendy_black_top',
  'victorian',
  'white_ruffled_shoulders',
  'white_sleeves'
);