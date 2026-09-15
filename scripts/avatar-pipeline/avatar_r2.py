import os, shlex, subprocess
from pathlib import Path

AVATAR_KEY_RE = r"^[^/][\w.-]+\.(png|jpg|jpeg|webp)$"

def avatar_key(filename: str) -> str:
    if filename.startswith("/avatars/"):
        filename = filename.removeprefix("/avatars/")
    if filename.startswith("/") or "/" in filename:
        raise ValueError(f"avatar key must be a bare filename: {filename}")
    return filename

def upload_avatar_to_r2(file_path: Path, key: str, *, dry_run: bool = False) -> str:
    bare_key = avatar_key(key)
    object_key = f"avatars/{bare_key}"
    cmd_template = os.getenv("R2_UPLOAD_CMD")
    bucket = os.getenv("R2_BUCKET_NAME")
    if not cmd_template and not bucket:
        if dry_run:
            print(f"dry-run R2 put {object_key}")
            return object_key
        print(f"Skipping avatar R2 upload for {object_key}: set R2_BUCKET_NAME or R2_UPLOAD_CMD")
        return object_key
    if cmd_template:
        cmd = shlex.split(cmd_template.format(file=shlex.quote(str(file_path)), key=shlex.quote(object_key), bare_key=shlex.quote(bare_key)))
    else:
        cmd = ["pnpm", "exec", "wrangler", "r2", "object", "put", f"{bucket}/{object_key}", "--file", str(file_path)]
    subprocess.run(cmd, check=True)
    return object_key
