# Codex 定时自动化

这个仓库不使用 GitHub Actions 做每日分析。GitHub Pages 只托管前端；Codex 的定时自动化对话负责读取黄金页面状态、刷新行情、分析并写回结果。

## 每日流程

1. 在交易日 14:30 左右运行：

   ```powershell
   python scripts\read_gold_context.py --refresh-market
   ```

2. 脚本会读取 Supabase `picker_settings` 表中的 `gold` 行，刷新上海黄金交易所 Au99.99 和中银上海金ETF联接C（009478）行情，并输出：

   - `market`：黄金和基金行情快照。
   - `holding` / `holding_metrics`：我的持仓和收益估算。
   - `plan` / `plan_metrics`：定投计划和估算买入份额。
   - `default_prompt`：给 Codex 的分析要求。
   - `write_result_schema`：写回结果需要遵守的 JSON 结构。

3. Codex 综合今日行情、持仓、定投和风险，自行生成 `result.json`：

   ```json
   {
     "trade_date": "2026-06-09",
     "generated_at": "2026-06-09T14:30:00+08:00",
     "title": "今日黄金持仓建议",
     "summary": "一段摘要",
     "action": "今日具体操作建议",
     "rationale": ["理由 1", "理由 2"],
     "risks": ["风险 1", "风险 2"]
   }
   ```

4. 写回页面：

   ```powershell
   python scripts\write_gold_result.py result.json
   ```

5. 页面 `https://myteamw.github.io/gold/` 会读取最新 `gold.advice` 并显示到“今日操作建议”。

## Codex 自动化提示词建议

```text
每个交易日 14:30 执行。进入 F:\Codes\Stock_Tracker\gold。
先运行 python scripts\read_gold_context.py --refresh-market，读取并刷新黄金页面状态、上海黄金交易所 Au99.99、中银上海金ETF联接C（009478）、我的基金份额持仓和定投计划。
你自己综合 default_prompt、market、holding_metrics、plan_metrics 和 quote_errors 做谨慎分析，生成符合 write_result_schema 的 JSON。
建议必须明确今日动作：继续定投、暂缓、逢低补、分批减仓或只观察；写清触发条件、风险点，以及定投金额或频率是否需要调整。
然后运行 python scripts\write_gold_result.py result.json 写入页面。不要触发 GitHub Actions，不要添加固定结尾套话。
```
