from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from typing import Any
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


def env_or(name: str, fallback: str) -> str:
  return os.environ.get(name) or fallback


SUPABASE_URL = env_or("GOLD_SUPABASE_URL", "https://kawztespuaiztftoifdk.supabase.co").rstrip("/")
SUPABASE_KEY = env_or("GOLD_SUPABASE_KEY", "sb_publishable_Ydf2JJK06d4GMTE2awOSwg_3GZLTR27")
SETTINGS_TABLE = env_or("GOLD_SETTINGS_TABLE", "picker_settings")
GOLD_ROW_KEY = env_or("GOLD_ROW_KEY", "gold")
CHINA_TZ = ZoneInfo("Asia/Shanghai")

DEFAULT_STATE = {
  "version": 1,
  "holding": {"shares": 0, "costAmount": 0},
  "plan": {"amount": 0, "frequency": "monthly"},
  "market": {"gold": None, "fund": None, "quoteErrors": [], "refreshedAt": ""},
  "advice": None,
}


def now_china() -> datetime:
  return datetime.now(CHINA_TZ)


def request_json(url: str, *, method: str = "GET", body: Any = None, headers: dict[str, str] | None = None) -> Any:
  payload = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
  request_headers = {
    "User-Agent": "Mozilla/5.0 GoldAutomation/1.0",
    "Accept": "application/json,text/plain,*/*",
  }
  if headers:
    request_headers.update(headers)
  request = Request(url, data=payload, method=method, headers=request_headers)
  with urlopen(request, timeout=20) as response:
    if response.status == 204:
      return None
    text = response.read().decode("utf-8", errors="replace")
    return json.loads(text) if text.strip() else None


def supabase_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
  headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
  }
  if extra:
    headers.update(extra)
  return headers


def supabase(path: str, *, method: str = "GET", body: Any = None, prefer: str | None = None) -> Any:
  headers = supabase_headers({"Prefer": prefer} if prefer else None)
  return request_json(f"{SUPABASE_URL}/rest/v1/{path}", method=method, body=body, headers=headers)


def normalize_state(raw: Any) -> dict[str, Any]:
  source = raw if isinstance(raw, dict) else {}
  state = json.loads(json.dumps(DEFAULT_STATE, ensure_ascii=False))
  state.update(source)
  state["holding"] = {**DEFAULT_STATE["holding"], **(source.get("holding") if isinstance(source.get("holding"), dict) else {})}
  state["plan"] = {**DEFAULT_STATE["plan"], **(source.get("plan") if isinstance(source.get("plan"), dict) else {})}
  state["market"] = {**DEFAULT_STATE["market"], **(source.get("market") if isinstance(source.get("market"), dict) else {})}
  state["advice"] = source.get("advice") if isinstance(source.get("advice"), dict) else None
  return state


def load_state() -> dict[str, Any]:
  rows = supabase(f"{SETTINGS_TABLE}?select=value&key=eq.{GOLD_ROW_KEY}&limit=1")
  if isinstance(rows, list) and rows and isinstance(rows[0].get("value"), dict):
    return normalize_state(rows[0]["value"])
  return normalize_state({})


def save_state(state: dict[str, Any]) -> None:
  supabase(
    f"{SETTINGS_TABLE}?on_conflict=key",
    method="POST",
    body={"key": GOLD_ROW_KEY, "value": state},
    prefer="resolution=merge-duplicates,return=minimal",
  )


def text(value: Any) -> str:
  return str(value or "").strip()


def text_list(value: Any) -> list[str]:
  if isinstance(value, list):
    return [text(item) for item in value if text(item)]
  if isinstance(value, str) and value.strip():
    return [value.strip()]
  return []


def read_payload() -> dict[str, Any]:
  path = sys.argv[1] if len(sys.argv) > 1 else "-"
  if path == "-":
    raw_text = sys.stdin.read()
  else:
    with open(path, "r", encoding="utf-8") as file:
      raw_text = file.read()
  payload = json.loads(raw_text)
  if isinstance(payload, dict) and isinstance(payload.get("result"), dict):
    payload = payload["result"]
  if not isinstance(payload, dict):
    raise ValueError("gold result payload must be a JSON object")
  return payload


def normalize_advice(payload: dict[str, Any]) -> dict[str, Any]:
  title = text(payload.get("title"))
  summary = text(payload.get("summary"))
  action = text(payload.get("action"))
  rationale = text_list(payload.get("rationale") or payload.get("reasons"))
  risks = text_list(payload.get("risks"))

  if not title:
    raise ValueError("title is required")
  if not summary:
    raise ValueError("summary is required")
  if not action:
    raise ValueError("action is required")
  if not rationale:
    raise ValueError("rationale must contain at least one item")
  if not risks:
    raise ValueError("risks must contain at least one item")

  return {
    "trade_date": text(payload.get("trade_date")) or now_china().date().isoformat(),
    "generated_at": text(payload.get("generated_at")) or now_china().isoformat(),
    "title": title,
    "summary": summary,
    "action": action,
    "rationale": rationale,
    "risks": risks,
  }


def main() -> None:
  payload = read_payload()
  state = load_state()
  if isinstance(payload.get("market"), dict):
    state["market"] = {**state.get("market", {}), **payload["market"]}
  state["advice"] = normalize_advice(payload)
  state["lastAdviceWriteAt"] = now_china().isoformat()
  save_state(state)
  print(json.dumps({"written": True, "trade_date": state["advice"]["trade_date"], "title": state["advice"]["title"]}, ensure_ascii=False))


if __name__ == "__main__":
  main()
