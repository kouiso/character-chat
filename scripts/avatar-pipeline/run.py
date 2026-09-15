#!/usr/bin/env python3
import argparse, base64, json, os, re, shlex, subprocess, sys, time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional
from urllib import parse, request

from avatar_r2 import upload_avatar_to_r2

MAX_ATTEMPTS = 3
DEFAULT_STATE = "queued"
NOVITA_POLL_MAX_TRIES = 8
NOVITA_POLL_BASE_SECONDS = 1.5
NOVITA_POLL_MAX_SECONDS = 12


@dataclass
class PipelineConfig:
    root: Path
    inventory_path: Path
    state_path: Path
    out_dir: Path
    manual_queue_path: Path
    repo_avatar_dir: Path
    wsl_judge_cmd: str
    d1_fetch_cmd: str
    d1_update_cmd: str
    novita_url: str
    novita_model: str
    dry_run: bool


def run(cmd: list[str], *, check: bool = True) -> str:
    proc = subprocess.run(cmd, shell=False, text=True, capture_output=True)
    if check and proc.returncode != 0:
        raise RuntimeError(f"Command failed ({proc.returncode}): {cmd}\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}")
    return proc.stdout.strip()


def format_cmd(template: str, **kwargs: str) -> list[str]:
    quoted = {k: shlex.quote(v) for k, v in kwargs.items()}
    return shlex.split(template.format(**quoted))


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def ensure_state(inventory: list[dict], state: Dict[str, Any]) -> Dict[str, Any]:
    for row in inventory:
        cid = row["id"]
        if cid not in state:
            state[cid] = {"status": DEFAULT_STATE, "attempts": 0, "updated_at": int(time.time())}
    return state


def next_char(inventory: list[dict], state: Dict[str, Any], pilot_ids: Optional[set[str]]) -> Optional[dict]:
    for row in inventory:
        cid = row["id"]
        if pilot_ids and cid not in pilot_ids:
            continue
        if state.get(cid, {}).get("status") == "queued":
            return row
    return None


def extract_appearance(system_prompt: str) -> str:
    m = re.search(r"【外見】\s*(.+?)(?:\n【|$)", system_prompt, re.S)
    return m.group(1).strip() if m else ""


def build_prompt(name: str, appearance: str, visual_prompt: str, hint: str = "") -> str:
    parts = [
        f"masterpiece, best quality, highly detailed anime portrait, upper body, {name}",
        appearance,
        visual_prompt,
        "soft cinematic light, sharp eyes, clean lineart, cohesive palette",
    ]
    if hint:
        parts.append(f"Refinement objective: {hint}")
    return ", ".join([p for p in parts if p])[:800]


def _novita_open(url: str, method: str, api_key: str, payload: Optional[dict] = None) -> dict:
    req = request.Request(
        url,
        data=(json.dumps(payload).encode() if payload is not None else None),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "User-Agent": "avatar-pipeline/1.0"},
        method=method,
    )
    try:
        with request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        body = ""
        try:
            body = e.read().decode()  # type: ignore[attr-defined]
        except Exception:
            pass
        print(f"[novita] {method} {url} failed: {e}\nbody: {body[:500]}\npayload: {json.dumps(payload, ensure_ascii=False)[:500] if payload else 'GET'}", file=sys.stderr)
        raise


def _novita_poll_result(api_key: str, task_id: str, cfg: PipelineConfig) -> dict:
    base = cfg.novita_url.rsplit('/', 1)[0]
    for attempt in range(1, NOVITA_POLL_MAX_TRIES + 1):
        poll_url = f"{base}/task-result?task_id={parse.quote(task_id)}"
        data = _novita_open(poll_url, "GET", api_key)
        images = data.get("images") or data.get("data", {}).get("images")
        if images:
            return data

        status = str(data.get("status") or data.get("task", {}).get("status") or "").lower()
        if status in {"failed", "error", "canceled", "cancelled"}:
            raise RuntimeError(f"Novita async task failed ({task_id}): {data}")

        if attempt == NOVITA_POLL_MAX_TRIES:
            break
        delay = min(NOVITA_POLL_BASE_SECONDS * (2 ** (attempt - 1)), NOVITA_POLL_MAX_SECONDS)
        time.sleep(delay)

    raise RuntimeError(f"Novita async task timeout ({task_id})")


def novita_generate(api_key: str, prompt: str, out_path: Path, cfg: PipelineConfig) -> None:
    if cfg.dry_run:
        out_path.write_bytes(b"dry-run-image")
        return
    payload = {
        "request": {
            "model_name": cfg.novita_model,
            "prompt": prompt,
            "width": 1024,
            "height": 1024,
            "steps": 30,
            "sampler_name": "DPM++ 2M Karras",
            "guidance_scale": 7,
            "image_num": 1,
        }
    }
    data = _novita_open(cfg.novita_url, "POST", api_key, payload)
    if not (data.get("images") or data.get("data", {}).get("images")):
        task_id = str(data.get("task_id") or data.get("data", {}).get("task_id") or "")
        if not task_id:
            raise RuntimeError(f"Novita response missing images/task_id: {data}")
        data = _novita_poll_result(api_key, task_id, cfg)

    image_item = (data.get("images") or data.get("data", {}).get("images") or [None])[0]
    if not image_item:
        raise RuntimeError(f"Novita response missing image after polling: {data}")

    image_url = None
    image_data = None
    if isinstance(image_item, dict):
        image_url = image_item.get("image_url")
        image_data = image_item.get("image_data")
    elif isinstance(image_item, str):
        image_data = image_item
    else:
        raise RuntimeError(f"Unsupported Novita image payload: {image_item}")

    if image_url:
        with request.urlopen(image_url, timeout=120) as resp:
            out_path.write_bytes(resp.read())
        return

    if not image_data:
        raise RuntimeError(f"Novita image payload missing image_url/image_data: {data}")
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    out_path.write_bytes(base64.b64decode(image_data))


def append_manual_queue(path: Path, char_id: str, reason: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(f"- {char_id}: {reason}\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(Path.home() / "avatar-pipeline"))
    ap.add_argument("--pilot-ids", default="")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    root = Path(args.root)
    cfg = PipelineConfig(
        root=root,
        inventory_path=root / "inventory.json",
        state_path=root / "state.json",
        out_dir=root / "out",
        manual_queue_path=root / ".work/avatar-rebuild/manual-queue.md",
        repo_avatar_dir=Path("public/avatars"),
        wsl_judge_cmd=os.getenv("WSL_JUDGE_CMD", "bash scripts/avatar-pipeline/judge.sh"),
        d1_fetch_cmd=os.getenv("D1_FETCH_CMD", "pnpm exec tsx scripts/avatar-pipeline/d1_fetch.ts {char_id}"),
        d1_update_cmd=os.getenv("D1_UPDATE_CMD", "pnpm exec tsx scripts/avatar-pipeline/d1_update.ts {char_id} {avatar} {prompt}"),
        novita_url=os.getenv("NOVITA_URL", "https://api.novita.ai/v3/async/txt2img"),
        novita_model=os.getenv("NOVITA_MODEL", "sdxl"),
        dry_run=args.dry_run,
    )

    inventory = load_json(cfg.inventory_path, [])
    if not inventory:
        print(f"inventory missing/empty: {cfg.inventory_path}", file=sys.stderr)
        return 2
    state = load_json(cfg.state_path, {})
    state = ensure_state(inventory, state)

    pilot_ids = set([x.strip() for x in args.pilot_ids.split(",") if x.strip()]) or None
    row = next_char(inventory, state, pilot_ids)
    if not row:
        print("no queued characters")
        save_json(cfg.state_path, state)
        return 0

    char_id = row["id"]
    char_state = state[char_id]
    out_dir = cfg.out_dir / char_id
    out_dir.mkdir(parents=True, exist_ok=True)

    char_state.update({"status": "generating", "updated_at": int(time.time())})
    save_json(cfg.state_path, state)

    retry_count = int(char_state.get("retry_count", 0))
    hint = ""
    final_pass = False
    final_img = None

    try:
        raw = run(format_cmd(cfg.d1_fetch_cmd, char_id=char_id)) if not cfg.dry_run else json.dumps({"name": row.get("name", char_id), "system_prompt": "【外見】silver hair, blue eyes", "visualPrompt": "school uniform"})
        meta = json.loads(raw)
        appearance = extract_appearance(meta.get("system_prompt", ""))
        a_text = {"name": meta.get("name"), "appearance": appearance, "visual_prompt": meta.get("visualPrompt", "")}
        save_json(out_dir / "a-text.json", a_text)

        api_key = os.getenv("NOVITA_API_KEY", "")
        if not api_key and not cfg.dry_run:
            raise RuntimeError("NOVITA_API_KEY is required")

        for i in range(1, MAX_ATTEMPTS + 1):
            prompt = build_prompt(a_text["name"], a_text["appearance"], a_text["visual_prompt"], hint)
            (out_dir / f"refined-prompt-{i}.txt").write_text(prompt, encoding="utf-8")
            img = out_dir / f"b-{i}.png"
            novita_generate(api_key, prompt, img, cfg)

            char_state.update({"status": "judging", "attempts": i, "updated_at": int(time.time())})
            save_json(cfg.state_path, state)

            judge_path = out_dir / f"judge-{i}.json"
            if cfg.dry_run:
                verdict = {"result": "PASS" if i == 1 else "FAIL", "refinement_hint": ""}
                save_json(judge_path, verdict)
            else:
                run(shlex.split(cfg.wsl_judge_cmd) + ["--a", str(out_dir / "a-text.json"), "--b", str(img), "--out", str(judge_path)])
                verdict = load_json(judge_path, {})

            if verdict.get("result") == "PASS":
                final_pass = True
                final_img = img
                break
            hint = verdict.get("refinement_hint", "improve similarity to textual identity")
    except Exception as exc:
        retry_count += 1
        char_state.update({"retry_count": retry_count, "updated_at": int(time.time())})
        if retry_count >= MAX_ATTEMPTS:
            char_state.update({"status": "manual_queue"})
            append_manual_queue(cfg.manual_queue_path, char_id, f"exception after {retry_count} retries: {exc}")
        else:
            char_state.update({"status": "queued"})
        save_json(cfg.state_path, state)
        raise

    if final_pass and final_img:
        avatar_name = f"{char_id}.png"
        upload_avatar_to_r2(final_img, avatar_name, dry_run=cfg.dry_run)
        if not cfg.dry_run:
            target = cfg.repo_avatar_dir / avatar_name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(final_img.read_bytes())
            run(format_cmd(cfg.d1_update_cmd, char_id=char_id, avatar=avatar_name, prompt=prompt))
        char_state.update({"status": "passed", "avatar": avatar_name, "updated_at": int(time.time())})
    else:
        char_state.update({"status": "manual_queue", "updated_at": int(time.time())})
        append_manual_queue(cfg.manual_queue_path, char_id, "failed after 3 attempts")

    save_json(cfg.state_path, state)
    print(json.dumps({"char_id": char_id, "status": char_state["status"], "attempts": char_state.get("attempts", 0)}, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
