-- #832: keep the profile-approved identity available to every chat image generation.
-- Do not overwrite an existing value because production may already contain a newer approved canon.
UPDATE character
SET image_meta = json_object(
  'appearance',
  '1girl, solo, long soft loose wavy honey-blonde light brown hair, voluminous fluffy hair, warm golden brown hair color, blue eyes, flower hair accessories (pink and yellow flowers) both sides, soft warm smile, gentle blush, fair skin, natural proportions, medium bust, early 20s university student',
  'artStyle',
  'soft anime illustration, warm golden lighting, painterly soft shading, romantic intimate atmosphere',
  'outfit',
  'off-shoulder white knit cardigan, bare shoulders and decolletage'
)
WHERE id = 'default-character'
  AND image_meta IS NULL;
