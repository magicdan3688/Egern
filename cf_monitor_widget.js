/**
 * Egern Widget: CF-Server-Monitor
 * 支持通过 Egern 环境变量动态配置参数
 * 
 * 环境变量支持 (可在 Egern 脚本界面配置)：
 * - API_URL: 监控端点，例如 https://cerha-monitor.cerha3688.com/api (必填)
 * - GROUP: 分组筛选 (可选)，例如 "国外", "国内", "Mac"，留空或 "all" 显示全部
 * - LIMIT: 显示服务器数量 (可选)，默认 4
 */

// 1. 读取环境变量 (兼容 ctx.env、全局 $env 及默认值)
const env = (typeof ctx !== "undefined" && ctx && ctx.env) 
  ? ctx.env 
  : (typeof $env !== "undefined" ? $env : {});

const API_URL = (env.API_URL || "").trim();
const FILTER_GROUP = (env.GROUP || "").trim();
const DISPLAY_LIMIT = parseInt(env.LIMIT, 10) || 4;

// 超过 180 秒无心跳视为离线
const OFFLINE_THRESHOLD_MS = 180 * 1000;

// 国家/地区代码转换为国旗 Emoji
function getFlagEmoji(region) {
  if (!region || region.length !== 2) return "🌐";
  const codePoints = region
    .toUpperCase()
    .split("")
    .map(c => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// 格式化网速
function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return "0 B/s";
  const units = ["B/s", "K/s", "M/s", "G/s"];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(1024));
  const val = (bytesPerSec / Math.pow(1024, i)).toFixed(1);
  return `${val}${units[i]}`;
}

async function fetchData(url) {
  const req = new Request(url);
  req.headers = {
    "User-Agent": "Egern-Monitor-Widget/1.0",
    "Accept": "application/json"
  };
  try {
    return await req.loadJSON();
  } catch (err) {
    return null;
  }
}

async function createWidget() {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#16181f");
  widget.setPadding(10, 12, 10, 12);

  // 校验必须填写的环境变量
  if (!API_URL) {
    const errText = widget.addText("⚠️ 未配置 API_URL");
    errText.font = Font.boldSystemFont(12);
    errText.textColor = new Color("#ef4444");

    widget.addSpacer(4);
    const tip = widget.addText("请在 Egern 环境变量添加:\nAPI_URL = 你的探针接口");
    tip.font = Font.systemFont(10);
    tip.textColor = new Color("#9ca3af");
    return widget;
  }

  const payload = await fetchData(API_URL);
  if (!payload || !payload.servers) {
    const errText = widget.addText("⚠️ 获取监控数据失败");
    errText.font = Font.systemFont(12);
    errText.textColor = new Color("#ef4444");
    return widget;
  }

  let { servers, stats } = payload;
  const now = Date.now();

  // 若设置了分组过滤，先做筛选
  if (FILTER_GROUP && FILTER_GROUP.toLowerCase() !== "all") {
    servers = servers.filter(s => s.server_group === FILTER_GROUP);
  }

  // 1. 顶部 Header
  const header = widget.addStack();
  header.layoutHorizontally();

  const titleText = FILTER_GROUP && FILTER_GROUP.toLowerCase() !== "all" 
    ? `⚡ ${FILTER_GROUP}` 
    : "⚡ 节点监控";
  const title = header.addText(titleText);
  title.font = Font.boldSystemFont(12);
  title.textColor = new Color("#f4f4f5");

  header.addSpacer();

  // 计算当前显示列表的在线/总数
  const total = servers.length;
  const online = servers.filter(s => (now - (s.last_updated || 0)) < OFFLINE_THRESHOLD_MS).length;
  
  const statusBadge = header.addText(`${online}/${total} 在线`);
  statusBadge.font = Font.boldSystemFont(11);
  statusBadge.textColor = (online === total && total > 0) ? new Color("#10b981") : new Color("#f59e0b");

  // 2. 统计行（全局上下行速率）
  if (stats && (stats.globalSpeedIn !== undefined || stats.globalSpeedOut !== undefined)) {
    widget.addSpacer(2);
    const speedRow = widget.addStack();
    speedRow.layoutHorizontally();
    
    const speedText = speedRow.addText(`↓ ${formatSpeed(stats.globalSpeedIn)}  ↑ ${formatSpeed(stats.globalSpeedOut)}`);
    speedText.font = Font.monospacedSystemFont(9, Font.regularWeight);
    speedText.textColor = new Color("#71717a");
  }

  widget.addSpacer(6);

  // 3. 服务器列表
  const displayServers = servers.slice(0, DISPLAY_LIMIT);

  if (displayServers.length === 0) {
    const emptyTip = widget.addText("暂无节点数据");
    emptyTip.font = Font.systemFont(11);
    emptyTip.textColor = new Color("#9ca3af");
    return widget;
  }

  for (const s of displayServers) {
    const isOnline = (now - (s.last_updated || 0)) < OFFLINE_THRESHOLD_MS;

    const row = widget.addStack();
    row.layoutHorizontally();

    // 在线圆点
    const dot = row.addText("● ");
    dot.font = Font.systemFont(10);
    dot.textColor = isOnline ? new Color("#10b981") : new Color("#ef4444");

    // 国旗
    const flag = row.addText(`${getFlagEmoji(s.region)} `);
    flag.font = Font.systemFont(10);

    // 节点名称
    const nameStr = s.name.length > 10 ? s.name.substring(0, 9) + "…" : s.name;
    const name = row.addText(nameStr);
    name.font = Font.systemFont(11);
    name.textColor = new Color("#e4e4e7");

    row.addSpacer();

    if (isOnline) {
      const cpuVal = Math.round(s.cpu || 0);
      const memVal = Math.round(((s.ram_used || 0) / (s.ram_total || 1)) * 100);
      const netDown = formatSpeed(s.net_in_speed || 0);

      const statText = row.addText(`C:${cpuVal}% M:${memVal}%  ${netDown}`);
      statText.font = Font.monospacedSystemFont(10, Font.regularWeight);
      statText.textColor = new Color("#a1a1aa");
    } else {
      const offlineText = row.addText("Offline");
      offlineText.font = Font.systemFont(10);
      offlineText.textColor = new Color("#ef4444");
    }

    widget.addSpacer(3);
  }

  return widget;
}

const widget = await createWidget();
Script.setWidget(widget);
Script.complete();
