const STORAGE_KEY = "myteamw-gold-state-v1";
const SUPABASE_URL = "https://kawztespuaiztftoifdk.supabase.co";
const SUPABASE_KEY = "sb_publishable_Ydf2JJK06d4GMTE2awOSwg_3GZLTR27";
const SETTINGS_TABLE = "picker_settings";
const GOLD_ROW_KEY = "gold";
const FUND_CODE = "009478";

const DEFAULT_STATE = {
  version: 1,
  holding: {
    grams: 0,
    costAmount: 0,
  },
  plan: {
    amount: 0,
    frequency: "monthly",
  },
  market: {
    gold: null,
    fund: null,
    quoteErrors: [],
    refreshedAt: "",
  },
  advice: null,
};

const state = {
  data: structuredClone(DEFAULT_STATE),
  remoteReady: false,
  saving: false,
};

const els = {
  clock: document.querySelector("#clockText"),
  status: document.querySelector("#updateStatus"),
  refresh: document.querySelector("#refreshButton"),
  goldQuoteDate: document.querySelector("#goldQuoteDate"),
  goldPrice: document.querySelector("#goldPrice"),
  goldChange: document.querySelector("#goldChange"),
  goldHigh: document.querySelector("#goldHigh"),
  goldLow: document.querySelector("#goldLow"),
  goldPrev: document.querySelector("#goldPrev"),
  goldUpdated: document.querySelector("#goldUpdated"),
  goldNote: document.querySelector("#goldNote"),
  fundDailyChange: document.querySelector("#fundDailyChange"),
  fundNav: document.querySelector("#fundNav"),
  fundChange: document.querySelector("#fundChange"),
  fundEstimate: document.querySelector("#fundEstimate"),
  fundDate: document.querySelector("#fundDate"),
  fundEstimateTime: document.querySelector("#fundEstimateTime"),
  holdingGramsInput: document.querySelector("#holdingGramsInput"),
  costAmountInput: document.querySelector("#costAmountInput"),
  saveHolding: document.querySelector("#saveHoldingButton"),
  planAmountInput: document.querySelector("#planAmountInput"),
  planFrequencyInput: document.querySelector("#planFrequencyInput"),
  savePlan: document.querySelector("#savePlanButton"),
  holdingAmount: document.querySelector("#holdingAmount"),
  holdingGrams: document.querySelector("#holdingGrams"),
  dailyProfit: document.querySelector("#dailyProfit"),
  holdingProfit: document.querySelector("#holdingProfit"),
  holdingYield: document.querySelector("#holdingYield"),
  costPrice: document.querySelector("#costPrice"),
  planAmount: document.querySelector("#planAmount"),
  planFrequency: document.querySelector("#planFrequency"),
  planEstimatedGrams: document.querySelector("#planEstimatedGrams"),
  planMonthlyBudget: document.querySelector("#planMonthlyBudget"),
  adviceGenerated: document.querySelector("#adviceGenerated"),
  adviceTradeDate: document.querySelector("#adviceTradeDate"),
  adviceContent: document.querySelector("#adviceContent"),
};

function setStatus(text) {
  els.status.textContent = text;
}

function chinaNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
}

function tickClock() {
  els.clock.textContent = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeNumber(value, fallback = 0) {
  const number = numberOrNull(value);
  return number === null ? fallback : number;
}

function money(value, digits = 2) {
  const number = numberOrNull(value);
  if (number === null) return "--";
  return number.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function signedMoney(value) {
  let number = numberOrNull(value);
  if (number === null) return "--";
  if (Math.abs(number) < 0.005) number = 0;
  const sign = number > 0 ? "+" : "";
  return `${sign}${money(number)}`;
}

function grams(value) {
  const number = numberOrNull(value);
  if (number === null) return "--";
  return `${number.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "")} 克`;
}

function percent(value) {
  let number = numberOrNull(value);
  if (number === null) return "--";
  if (Math.abs(number) < 0.005) number = 0;
  const sign = number > 0 ? "+" : "";
  return `${sign}${number.toFixed(2)}%`;
}

function formatDateTime(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/\//gu, "-");
}

function normalizeState(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    ...structuredClone(DEFAULT_STATE),
    ...source,
    holding: {
      ...DEFAULT_STATE.holding,
      ...(source.holding && typeof source.holding === "object" ? source.holding : {}),
    },
    plan: {
      ...DEFAULT_STATE.plan,
      ...(source.plan && typeof source.plan === "object" ? source.plan : {}),
    },
    market: {
      ...DEFAULT_STATE.market,
      ...(source.market && typeof source.market === "object" ? source.market : {}),
    },
    advice: source.advice && typeof source.advice === "object" ? source.advice : null,
  };
}

function localState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function writeLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

async function supabase(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function loadRemoteState() {
  const rows = await supabase(`${SETTINGS_TABLE}?select=value&key=eq.${encodeURIComponent(GOLD_ROW_KEY)}&limit=1`);
  if (Array.isArray(rows) && rows[0] && rows[0].value) {
    state.data = normalizeState(rows[0].value);
    state.remoteReady = true;
    writeLocalState();
    return;
  }
  state.data = localState();
  await saveState("初始化黄金页数据");
}

async function saveState(successText = "已保存") {
  if (state.saving) return;
  state.saving = true;
  writeLocalState();
  try {
    await supabase(`${SETTINGS_TABLE}?on_conflict=key`, {
      method: "POST",
      body: {
        key: GOLD_ROW_KEY,
        value: state.data,
      },
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    state.remoteReady = true;
    setStatus(successText);
  } catch (error) {
    state.remoteReady = false;
    setStatus(`已保存到本机，远端失败：${error.message}`);
  } finally {
    state.saving = false;
  }
}

function applyInputs() {
  const holding = state.data.holding;
  const plan = state.data.plan;
  els.holdingGramsInput.value = safeNumber(holding.grams) || "";
  els.costAmountInput.value = safeNumber(holding.costAmount) || "";
  els.planAmountInput.value = safeNumber(plan.amount) || "";
  els.planFrequencyInput.value = plan.frequency || "monthly";
}

function setChangeChip(element, value, fallback = "--") {
  const number = numberOrNull(value);
  element.classList.remove("up", "down", "neutral");
  if (number === null) {
    element.textContent = fallback;
    element.classList.add("neutral");
    return;
  }
  element.textContent = percent(number);
  element.classList.add(number > 0 ? "up" : number < 0 ? "down" : "neutral");
}

function setSignedMetric(element, value, formatter = signedMoney) {
  const number = numberOrNull(value);
  element.classList.remove("gain", "loss");
  element.textContent = formatter(value);
  if (number > 0) element.classList.add("gain");
  if (number < 0) element.classList.add("loss");
}

function currentGoldPrice() {
  return numberOrNull(state.data.market.gold && state.data.market.gold.price);
}

function fundComparison(fund) {
  const latestNav = numberOrNull(fund && fund.nav);
  const baseNav = numberOrNull(fund && fund.previous_nav);
  const currentEstimate = numberOrNull(fund && fund.estimated_nav);
  const storedAmount = numberOrNull(fund && fund.change_amount);
  const previousNav = storedAmount !== null && baseNav !== null ? baseNav : latestNav;
  const currentValue = storedAmount !== null && latestNav !== null ? latestNav : currentEstimate ?? latestNav;
  const storedPercent = numberOrNull(fund && fund.change_percent);
  const changeAmount =
    storedAmount ?? (currentValue !== null && previousNav !== null ? currentValue - previousNav : null);
  const changePercent =
    storedPercent ?? (changeAmount !== null && previousNav ? (changeAmount / previousNav) * 100 : null);
  return { currentValue, previousNav, changeAmount, changePercent };
}

function renderMarket() {
  const market = state.data.market || {};
  const gold = market.gold || {};
  const fund = market.fund || {};
  const fundMove = fundComparison(fund);

  els.goldQuoteDate.textContent = gold.quote_date || "--";
  els.goldPrice.textContent = money(gold.price);
  setChangeChip(els.goldChange, gold.change_percent);
  els.goldHigh.textContent = money(gold.high);
  els.goldLow.textContent = money(gold.low);
  els.goldPrev.textContent = money(gold.previous_close);
  els.goldUpdated.textContent = formatDateTime(gold.refreshed_at || market.refreshedAt);
  const errors = Array.isArray(market.quoteErrors) ? market.quoteErrors : [];
  if (errors.length) {
    els.goldNote.hidden = false;
    els.goldNote.textContent = `行情源提示：${errors.slice(0, 2).join("；")}`;
  } else {
    els.goldNote.hidden = true;
    els.goldNote.textContent = "";
  }

  setSignedMetric(els.fundDailyChange, fundMove.changeAmount, (value) => {
    const number = numberOrNull(value);
    if (number === null) return "--";
    const sign = number > 0 ? "+" : "";
    return `${sign}${money(number, 4)}`;
  });
  setChangeChip(els.fundChange, fundMove.changePercent);
  els.fundEstimate.textContent = money(fundMove.currentValue, 4);
  els.fundNav.textContent = money(fundMove.previousNav, 4);
  els.fundDate.textContent = fund.nav_date || "--";
  els.fundEstimateTime.textContent = fund.estimate_time || "--";
}

function holdingMetrics() {
  const holding = state.data.holding || {};
  const gramsValue = safeNumber(holding.grams);
  const costAmount = safeNumber(holding.costAmount);
  const price = currentGoldPrice();
  const previousClose = numberOrNull(state.data.market.gold && state.data.market.gold.previous_close);
  const holdingAmount = price === null ? null : gramsValue * price;
  const dailyProfit = price === null || previousClose === null ? null : gramsValue * (price - previousClose);
  const holdingProfit = holdingAmount === null || costAmount <= 0 ? null : holdingAmount - costAmount;
  const holdingYield = holdingProfit === null || costAmount <= 0 ? null : (holdingProfit / costAmount) * 100;
  const costPrice = gramsValue > 0 && costAmount > 0 ? costAmount / gramsValue : null;

  return {
    gramsValue,
    costAmount,
    holdingAmount,
    dailyProfit,
    holdingProfit,
    holdingYield,
    costPrice,
  };
}

function frequencyText(value) {
  return {
    weekly: "每周",
    biweekly: "每两周",
    monthly: "每月",
  }[value] || "每月";
}

function monthlyMultiplier(value) {
  return {
    weekly: 52 / 12,
    biweekly: 26 / 12,
    monthly: 1,
  }[value] || 1;
}

function renderPortfolio() {
  const metrics = holdingMetrics();
  const plan = state.data.plan || {};
  const price = currentGoldPrice();
  const planAmount = safeNumber(plan.amount);
  const estimatedGrams = price === null || price <= 0 ? null : planAmount / price;
  const monthlyBudget = planAmount * monthlyMultiplier(plan.frequency);

  els.holdingAmount.textContent = metrics.holdingAmount === null ? "--" : `¥${money(metrics.holdingAmount)}`;
  els.holdingGrams.textContent = grams(metrics.gramsValue);
  setSignedMetric(els.dailyProfit, metrics.dailyProfit);
  setSignedMetric(els.holdingProfit, metrics.holdingProfit);
  setSignedMetric(els.holdingYield, metrics.holdingYield, percent);
  els.costPrice.textContent = metrics.costPrice === null ? "--" : `${money(metrics.costPrice)} 元/克`;

  els.planAmount.textContent = `¥${money(planAmount)}`;
  els.planFrequency.textContent = frequencyText(plan.frequency);
  els.planEstimatedGrams.textContent = estimatedGrams === null ? "--" : grams(estimatedGrams);
  els.planMonthlyBudget.textContent = `¥${money(monthlyBudget)}`;
}

function list(items, className) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!values.length) return "";
  return `<ul class="${className}">${values.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#039;");
}

function renderAdvice() {
  const advice = state.data.advice;
  if (!advice) {
    els.adviceGenerated.textContent = "等待 Codex 自动化写入";
    els.adviceTradeDate.textContent = "--";
    els.adviceContent.textContent =
      "暂无今日操作建议。定时 Codex 自动化运行后，这里会显示结合今日行情、持仓和定投情况生成的建议。";
    return;
  }

  els.adviceGenerated.textContent = advice.generated_at ? `生成于 ${formatDateTime(advice.generated_at)}` : "已生成";
  els.adviceTradeDate.textContent = advice.trade_date || "--";
  els.adviceContent.innerHTML = [
    `<div class="advice-title">${escapeHtml(advice.title || "今日操作建议")}</div>`,
    advice.action ? `<div class="advice-action">${escapeHtml(advice.action)}</div>` : "",
    advice.summary ? `<div>${escapeHtml(advice.summary)}</div>` : "",
    list(advice.rationale, "advice-list"),
    list(advice.risks, "advice-list"),
  ]
    .filter(Boolean)
    .join("");
}

function render() {
  renderMarket();
  renderPortfolio();
  renderAdvice();
}

function updateHoldingFromInputs() {
  state.data.holding = {
    ...state.data.holding,
    grams: safeNumber(els.holdingGramsInput.value),
    costAmount: safeNumber(els.costAmountInput.value),
    updatedAt: chinaNow().toISOString(),
  };
  renderPortfolio();
}

function updatePlanFromInputs() {
  state.data.plan = {
    ...state.data.plan,
    amount: safeNumber(els.planAmountInput.value),
    frequency: els.planFrequencyInput.value || "monthly",
    updatedAt: chinaNow().toISOString(),
  };
  renderPortfolio();
}

async function loadFundEstimate() {
  return new Promise((resolve, reject) => {
    const callbackName = "jsonpgz";
    const previousCallback = window[callbackName];
    const script = document.createElement("script");
    const cleanup = () => {
      script.remove();
      window[callbackName] = previousCallback;
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("基金估值请求超时"));
    }, 10000);

    window[callbackName] = (payload) => {
      window.clearTimeout(timer);
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new Error("基金估值请求失败"));
    };
    script.src = `https://fundgz.1234567.com.cn/js/${FUND_CODE}.js?rt=${Date.now()}`;
    document.body.appendChild(script);
  });
}

async function loadFundHistory() {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const previousTrend = window.Data_netWorthTrend;
    const cleanup = () => {
      script.remove();
      if (previousTrend === undefined) {
        delete window.Data_netWorthTrend;
      } else {
        window.Data_netWorthTrend = previousTrend;
      }
    };

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("基金历史净值请求超时"));
    }, 10000);

    script.onload = () => {
      window.clearTimeout(timer);
      const trend = Array.isArray(window.Data_netWorthTrend) ? window.Data_netWorthTrend : [];
      const result = trend.slice(-2).map((item) => ({
        date: formatFundTrendDate(item.x),
        nav: numberOrNull(item.y),
        change_percent: numberOrNull(item.equityReturn),
      }));
      cleanup();
      resolve(result);
    };

    script.onerror = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new Error("基金历史净值请求失败"));
    };
    script.src = `https://fund.eastmoney.com/pingzhongdata/${FUND_CODE}.js?v=${Date.now()}`;
    document.body.appendChild(script);
  });
}

function formatFundTrendDate(value) {
  const timestamp = numberOrNull(value);
  if (timestamp === null) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function mergeFundHistory(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return false;
  const previous = rows[0] || {};
  const latest = rows[1] || {};
  const previousNav = numberOrNull(previous.nav);
  const latestNav = numberOrNull(latest.nav);
  if (previousNav === null || latestNav === null) return false;
  const changeAmount = latestNav - previousNav;
  const changePercent = numberOrNull(latest.change_percent) ?? (previousNav ? (changeAmount / previousNav) * 100 : null);
  state.data.market = {
    ...state.data.market,
    fund: {
      ...(state.data.market.fund || {}),
      code: FUND_CODE,
      name: (state.data.market.fund && state.data.market.fund.name) || "中银上海金ETF联接C",
      nav: latestNav,
      nav_date: latest.date || "",
      previous_nav: previousNav,
      previous_nav_date: previous.date || "",
      change_amount: changeAmount,
      change_percent: changePercent,
      refreshed_at: chinaNow().toISOString(),
    },
    refreshedAt: chinaNow().toISOString(),
  };
  return true;
}

function mergeFundEstimate(payload) {
  if (!payload || typeof payload !== "object") return false;
  const nav = numberOrNull(payload.dwjz);
  const estimatedNav = numberOrNull(payload.gsz);
  const changeAmount = nav !== null && estimatedNav !== null ? estimatedNav - nav : null;
  const existingFund = state.data.market.fund || {};
  const hasHistoryMove = numberOrNull(existingFund.change_amount) !== null && numberOrNull(existingFund.change_percent) !== null;
  state.data.market = {
    ...state.data.market,
    fund: {
      ...existingFund,
      code: FUND_CODE,
      name: payload.name || "中银上海金ETF联接C",
      nav: hasHistoryMove ? existingFund.nav : nav,
      nav_date: hasHistoryMove ? existingFund.nav_date : payload.jzrq || "",
      estimated_nav: estimatedNav,
      change_amount: hasHistoryMove ? existingFund.change_amount : changeAmount,
      change_percent: hasHistoryMove ? existingFund.change_percent : numberOrNull(payload.gszzl),
      estimate_time: payload.gztime || "",
      refreshed_at: chinaNow().toISOString(),
    },
    refreshedAt: chinaNow().toISOString(),
  };
  return true;
}

async function refreshPageData() {
  setStatus("正在刷新...");
  try {
    await loadRemoteState();
    try {
      const fundHistory = await loadFundHistory();
      if (mergeFundHistory(fundHistory)) {
        await saveState("基金历史净值已刷新");
      }
    } catch (historyError) {
      setStatus(`已读取远端，基金历史净值失败：${historyError.message}`);
    }
    try {
      const fundPayload = await loadFundEstimate();
      if (mergeFundEstimate(fundPayload)) {
        await saveState("基金估值已刷新");
      }
    } catch (fundError) {
      setStatus(`已读取远端，基金估值失败：${fundError.message}`);
    }
    applyInputs();
    render();
    if (state.remoteReady) setStatus("数据已同步");
  } catch (error) {
    state.data = localState();
    applyInputs();
    render();
    setStatus(`远端读取失败，已使用本机数据：${error.message}`);
  }
}

els.refresh.addEventListener("click", refreshPageData);
els.saveHolding.addEventListener("click", async () => {
  updateHoldingFromInputs();
  await saveState("持仓已保存");
});
els.savePlan.addEventListener("click", async () => {
  updatePlanFromInputs();
  await saveState("定投已保存");
});

for (const input of [els.holdingGramsInput, els.costAmountInput]) {
  input.addEventListener("input", updateHoldingFromInputs);
}

for (const input of [els.planAmountInput, els.planFrequencyInput]) {
  input.addEventListener("input", updatePlanFromInputs);
}

tickClock();
window.setInterval(tickClock, 1000);
refreshPageData();
