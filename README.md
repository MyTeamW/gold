# 黄金助手

一个纯静态的黄金持仓和定投辅助网页，目标地址为 `https://myteamw.github.io/gold/`。

## 功能

- 顶部显示今日国内黄金行情（上海黄金交易所 Au99.99）和中银上海金ETF联接C（009478）。
- 中间维护我的持仓情况：持有金额、持有克数、昨日收益、持有收益、持有收益率。
- 中间维护定投情况：定投金额、定投频率，并按今日金价估算单次可买克数。
- 底部展示 Codex 每日自动化写回的今日操作建议。

## 数据

网页是静态页面，不直接调用模型。页面状态写入现有 Supabase `picker_settings` 表中的 `gold` 行：

- `holding`：持有克数、成本金额。
- `plan`：定投金额、定投频率。
- `market`：自动化刷新后的 Au99.99 和 009478 行情快照。
- `advice`：Codex 自动化生成的当日建议。

这复用了现有 Supabase 项目和公开 publishable key，避免为新页面额外建表。

## 自动化

见 `CODEX_AUTOMATION.md`。

常用流程：

```powershell
python scripts\read_gold_context.py --refresh-market
```

Codex 根据输出内容生成 `result.json` 后写回：

```powershell
python scripts\write_gold_result.py result.json
```

本工具只做信息整理和仓位纪律提醒，不构成投资建议。
