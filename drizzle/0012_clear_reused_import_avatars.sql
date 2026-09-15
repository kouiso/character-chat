UPDATE character
SET avatar = NULL
WHERE id LIKE 'import-%'
  AND avatar = '/avatars/char-koharu.jpg';
