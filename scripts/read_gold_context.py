from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


def env_or(name: str, fallback: str) -> str:
  return os.environ.get(name) or fallback


SUPABASE_URL = env_or("GOLD_SUPABASE_URL", "https://kawztespuaiztftoifdk.supabase.co").rstrip("/")
SUPABASE_KEY = env_or("GOLD_SUPABASE_KEY", "sb_publishable_Ydf2JJK06d4GMTE2awOSwg_3GZLTR27")
SETTINGS_TABLE = env_or("GOLD_SETTINGS_TABLE", "picker_settings")
GOLD_ROW_KEY = env_or("GOLD_ROW_KEY", "gold")
FUND_CODE = env_or("GOLD_FUND_CODE", "009478")
PAGE_URL = "https://myteamw.github.io/gold/"
CHINA_TZ = ZoneInfo("Asia/Shanghai")


DEFAULT_STATE = {
  "version": 1,
  "holding": {"grams": 0, "costAmount": 0},
  "plan": {"amount": 0, "frequency": "monthly"},
  "market": {"gold": None, "fund": None, "quoteErrors": [], "refreshedAt": ""},
  "advice": None,
}


def now_china() -> datetime:
  return datetime.now(CHINA_TZ)


def number_or_none(value: Any) -> float | None:
  try:
    number = float(value)
  except (TypeError, ValueError):
    return None
  return number if number == number else None


def clean_number(value: Any) -> float | None:
  number = number_or_none(value)
  return number if number is not None and number > 0 else None


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


def request_text(url: str, *, headers: dict[str, str] | None = None, encoding: str = "utf-8") -> str:
  request_headers = {
    "User-Agent": "Mozilla/5.0 GoldAutomation/1.0",
    "Accept": "text/plain,*/*",
  }
  if headers:
    request_headers.update(headers)
  request = Request(url, headers=request_headers)
  with urlopen(request, timeout=20) as response:
    return response.read().decode(encoding, errors="replace")


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


def fetch_sge_quote(errors: list[str]) -> dict[str, Any]:
  realtime_rows: list[dict[str, Any]] = []
  hist_rows: list[dict[str, Any]] = []

  try:
    import akshare as ak

    try:
      realtime_df = ak.spot_quotations_sge(symbol="Au99.99")
      realtime_rows = json.loads(realtime_df.to_json(orient="records", force_ascii=False, date_format="iso"))
    except Exception as exc:
      errors.append(f"SGE realtime: {exc}")

    try:
      hist_df = ak.spot_hist_sge(symbol="Au99.99")
      hist_rows = json.loads(hist_df.to_json(orient="records", force_ascii=False, date_format="iso"))
    except Exception as exc:
      errors.append(f"SGE history: {exc}")
  except Exception as exc:
    errors.append(f"akshare import: {exc}")

  now = now_china()
  prices = [clean_number(row.get("现价")) for row in realtime_rows]
  prices = [price for price in prices if price is not None]
  latest_price = prices[-1] if prices else None
  intraday_high = max(prices) if prices else None
  intraday_low = min(prices) if prices else None

  hist_rows = sorted(hist_rows, key=lambda row: str(row.get("date") or ""))
  latest_hist = hist_rows[-1] if hist_rows else {}
  previous_hist = hist_rows[-2] if len(hist_rows) >= 2 else {}

  hist_close = clean_number(latest_hist.get("close"))
  price = latest_price or hist_close
  if price is None:
    raise RuntimeError("no Au99.99 price from SGE")

  previous_close = clean_number(previous_hist.get("close"))
  high = intraday_high or clean_number(latest_hist.get("high"))
  low = intraday_low or clean_number(latest_hist.get("low"))
  open_price = clean_number(latest_hist.get("open"))
  change_amount = price - previous_close if previous_close else None
  change_percent = (change_amount / previous_close) * 100 if change_amount is not None and previous_close else None
  quote_date = str(latest_hist.get("date") or now.date().isoformat())[:10]

  return {
    "symbol": "Au99.99",
    "name": "上海黄金交易所 Au99.99",
    "price": round(price, 2),
    "high": round(high, 2) if high is not None else None,
    "low": round(low, 2) if low is not None else None,
    "open": round(open_price, 2) if open_price is not None else None,
    "previous_close": round(previous_close, 2) if previous_close is not None else None,
    "change_amount": round(change_amount, 2) if change_amount is not None else None,
    "change_percent": round(change_percent, 2) if change_percent is not None else None,
    "quote_date": quote_date,
    "refreshed_at": now.isoformat(),
    "source": "akshare.spot_quotations_sge/spot_hist_sge",
  }


def fetch_fund_quote() -> dict[str, Any]:
  text = request_text(
    f"https://fundgz.1234567.com.cn/js/{FUND_CODE}.js?rt={int(time.time() * 1000)}",
    headers={"Referer": "https://fund.eastmoney.com/"},
  )
  match = re.search(r"jsonpgz\((.*)\)\s*;?\s*$", text)
  if not match:
    raise RuntimeError("fund payload is not jsonpgz")
  payload = json.loads(match.group(1))
  nav = number_or_none(payload.get("dwjz"))
  estimated_nav = number_or_none(payload.get("gsz"))
  change_amount = estimated_nav - nav if estimated_nav is not None and nav is not None else None
  change_percent = number_or_none(payload.get("gszzl"))
  history = fetch_fund_history()
  if history:
    nav = history["nav"]
    change_amount = history["change_amount"]
    change_percent = history["change_percent"]
  return {
    "code": FUND_CODE,
    "name": payload.get("name") or "中银上海金ETF联接C",
    "nav": nav,
    "nav_date": history.get("nav_date") if history else payload.get("jzrq") or "",
    "previous_nav": history.get("previous_nav") if history else None,
    "previous_nav_date": history.get("previous_nav_date") if history else "",
    "estimated_nav": estimated_nav,
    "change_amount": round(change_amount, 4) if change_amount is not None else None,
    "change_percent": change_percent,
    "estimate_time": payload.get("gztime") or "",
    "refreshed_at": now_china().isoformat(),
    "source": "fundgz.1234567.com.cn",
  }


def fund_trend_date(value: Any) -> str:
  timestamp = number_or_none(value)
  if timestamp is None:
    return ""
  return datetime.fromtimestamp(timestamp / 1000, CHINA_TZ).date().isoformat()


def fetch_fund_history() -> dict[str, Any] | None:
  try:
    text = request_text(
      f"https://fund.eastmoney.com/pingzhongdata/{FUND_CODE}.js?v={int(time.time() * 1000)}",
      headers={"Referer": "https://fund.eastmoney.com/"},
    )
    match = re.search(r"var Data_netWorthTrend = (\[.*?\]);/\*累计净值走势", text, re.S)
    if not match:
      return None
    rows = json.loads(match.group(1))
    if not isinstance(rows, list) or len(rows) < 2:
      return None
    previous = rows[-2]
    latest = rows[-1]
    if not isinstance(previous, dict) or not isinstance(latest, dict):
      return None
    previous_nav = number_or_none(previous.get("y"))
    latest_nav = number_or_none(latest.get("y"))
    if previous_nav is None or latest_nav is None:
      return None
    change_amount = latest_nav - previous_nav
    change_percent = number_or_none(latest.get("equityReturn"))
    if change_percent is None and previous_nav:
      change_percent = (change_amount / previous_nav) * 100
    return {
      "nav": latest_nav,
      "nav_date": fund_trend_date(latest.get("x")),
      "previous_nav": previous_nav,
      "previous_nav_date": fund_trend_date(previous.get("x")),
      "change_amount": change_amount,
      "change_percent": change_percent,
    }
  except Exception:
    return None


def refresh_market(state: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
  errors: list[str] = []
  market = state.get("market") if isinstance(state.get("market"), dict) else {}

  try:
    market["gold"] = fetch_sge_quote(errors)
  except Exception as exc:
    errors.append(str(exc))

  try:
    market["fund"] = fetch_fund_quote()
  except (HTTPError, URLError, TimeoutError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
    errors.append(f"fund {FUND_CODE}: {exc}")

  market["quoteErrors"] = errors
  market["refreshedAt"] = now_china().isoformat()
  state["market"] = market
  return state, errors


def frequency_text(value: Any) -> str:
  return {"weekly": "每周", "biweekly": "每两周", "monthly": "每月"}.get(str(value or ""), "每月")


def monthly_multiplier(value: Any) -> float:
  return {"weekly": 52 / 12, "biweekly": 26 / 12, "monthly": 1}.get(str(value or ""), 1)


def holding_metrics(state: dict[str, Any]) -> dict[str, Any]:
  holding = state.get("holding") if isinstance(state.get("holding"), dict) else {}
  market = state.get("market") if isinstance(state.get("market"), dict) else {}
  gold = market.get("gold") if isinstance(market.get("gold"), dict) else {}
  grams = number_or_none(holding.get("grams")) or 0
  cost_amount = number_or_none(holding.get("costAmount")) or 0
  price = number_or_none(gold.get("price"))
  previous_close = number_or_none(gold.get("previous_close"))
  holding_amount = grams * price if price is not None else None
  daily_profit = grams * (price - previous_close) if price is not None and previous_close is not None else None
  holding_profit = holding_amount - cost_amount if holding_amount is not None and cost_amount > 0 else None
  holding_yield = holding_profit / cost_amount * 100 if holding_profit is not None and cost_amount > 0 else None
  cost_price = cost_amount / grams if grams > 0 and cost_amount > 0 else None
  return {
    "holding_amount": holding_amount,
    "grams": grams,
    "cost_amount": cost_amount,
    "daily_profit": daily_profit,
    "holding_profit": holding_profit,
    "holding_yield": holding_yield,
    "cost_price": cost_price,
  }


def plan_metrics(state: dict[str, Any]) -> dict[str, Any]:
  plan = state.get("plan") if isinstance(state.get("plan"), dict) else {}
  market = state.get("market") if isinstance(state.get("market"), dict) else {}
  gold = market.get("gold") if isinstance(market.get("gold"), dict) else {}
  amount = number_or_none(plan.get("amount")) or 0
  price = number_or_none(gold.get("price"))
  frequency = str(plan.get("frequency") or "monthly")
  return {
    "amount": amount,
    "frequency": frequency_text(frequency),
    "estimated_grams": amount / price if price and price > 0 else None,
    "monthly_budget": amount * monthly_multiplier(frequency),
  }


def build_context(state: dict[str, Any], errors: list[str]) -> dict[str, Any]:
  metrics = holding_metrics(state)
  plan = plan_metrics(state)
  default_prompt = (
    "请你作为谨慎的黄金持仓助手，根据今日国内黄金行情、009478 中银上海金ETF联接C、"
    "我的持仓情况和定投计划，生成今日操作建议。建议需要明确今日动作：继续定投、暂缓、逢低补、"
    "分批减仓或只观察；说明触发条件、风险点和定投是否调整。不要添加固定套话，不构成投资建议的提示无需重复。"
  )
  return {
    "page_url": PAGE_URL,
    "trade_date": now_china().date().isoformat(),
    "generated_at": now_china().isoformat(),
    "default_prompt": default_prompt,
    "gold_state": state,
    "market": state.get("market"),
    "holding": state.get("holding"),
    "holding_metrics": metrics,
    "plan": state.get("plan"),
    "plan_metrics": plan,
    "quote_errors": errors,
    "write_result_schema": {
      "trade_date": "YYYY-MM-DD",
      "generated_at": "ISO-8601 datetime",
      "title": "简短标题",
      "summary": "一段摘要",
      "action": "今日具体操作建议",
      "rationale": ["理由 1", "理由 2"],
      "risks": ["风险 1", "风险 2"],
    },
  }


def main() -> None:
  refresh = "--refresh-market" in sys.argv
  output_path = "codex_context.latest.json"
  state = load_state()
  errors: list[str] = []
  if refresh:
    state, errors = refresh_market(state)
    save_state(state)
  else:
    market = state.get("market") if isinstance(state.get("market"), dict) else {}
    errors = list(market.get("quoteErrors") or [])

  context = build_context(state, errors)
  with open(output_path, "w", encoding="utf-8") as file:
    json.dump(context, file, ensure_ascii=False, indent=2)
  print(json.dumps(context, ensure_ascii=False, indent=2))


if __name__ == "__main__":
  main()
