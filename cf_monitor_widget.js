/**
 * Egern Widget: CF-Server-Monitor
 * 支持通过 Egern 环境变量动态配置参数
 * 
 * 环境变量支持 (可在 Egern 脚本界面配置)：
 * - API_URL: 监控端点，例如 https://域名/api (必填)
 * - GROUP: 分组筛选 (可选)，例如 "国外", "国内", 留空或 "all" 显示全部
 * - LIMIT: 显示服务器数量 (可选)，默认 4
/**
 * Egern 原生 Generic Widget: CF-Server-Monitor
 */

const OFFLINE_THRESHOLD_MS = 180 * 1000;

function getFlagEmoji(region) {
  if (!region || region.length !== 2) return "🌐";
  const codePoints = region
    .toUpperCase()
    .split("")
    .map(c => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return "0 B/s";
  const units = ["B/s", "K/s", "M/s", "G/s"];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(1024));
  const val = (bytesPerSec / Math.pow(1024, i)).toFixed(1);
  return `${val}${units[i]}`;
}

export default async function(ctx) {
  const env = ctx.env || {};
  const apiUrl = (env.API_URL || "https://cerha-monitor.cerha3688.com/api").trim();
  const filterGroup = (env.GROUP || "").trim();
  const displayLimit = parseInt(env.LIMIT, 10) || 4;

  let payload = null;
  let errorDetail = "";

  try {
    // 伪装完整浏览器请求头，避免触发 Cloudflare WAF 拦截
    const resp = await ctx.http.get(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": "https://cerha-monitor.cerha3688.com/",
        "Origin": "https://cerha-monitor.cerha3688.com"
      }
    });

    if (resp.status && resp.status !== 200) {
      errorDetail = `HTTP 状态码: ${resp.status}`;
    } else {
      payload = await resp.json();
    }
  } catch (err) {
    errorDetail = String(err?.message || err || "网络超时");
  }

  // 获取失败处理
  if (!payload || !payload.servers) {
    return {
      type: "widget",
      backgroundColor: "#16181f",
      padding: 12,
      children: [
        {
          type: "text",
          text: "⚠️ 获取探针数据失败",
          font: { size: 12, weight: "bold" },
          textColor: "#ef4444"
        },
        { type: "spacer", length: 4 },
        {
          type: "text",
          text: errorDetail || "未能解析到 servers 节点",
          font: { size: 10, family: "Menlo" },
          textColor: "#f87171"
        },
        { type: "spacer", length: 4 },
        {
          type: "text",
          text: `目标: ${apiUrl.substring(0, 32)}...`,
          font: { size: 9 },
          textColor: "#71717a"
        }
      ]
    };
  }

  let servers = payload.servers || [];
  const stats = payload.stats;
  const now = Date.now();

  if (filterGroup && filterGroup.toLowerCase() !== "all") {
    servers = servers.filter(s => s.server_group === filterGroup);
  }

  const total = servers.length;
  const online = servers.filter(s => (now - (s.last_updated || 0)) < OFFLINE_THRESHOLD_MS).length;

  const titleText = filterGroup && filterGroup.toLowerCase() !== "all" 
    ? `⚡ ${filterGroup}` 
    : "⚡ 节点监控";

  const widgetChildren = [
    {
      type: "stack",
      direction: "horizontal",
      alignItems: "center",
      children: [
        {
          type: "text",
          text: titleText,
          font: { size: 12, weight: "bold" },
          textColor: "#f4f4f5"
        },
        { type: "spacer" },
        {
          type: "text",
          text: `${online}/${total} 在线`,
          font: { size: 11, weight: "bold" },
          textColor: (online === total && total > 0) ? "#10b981" : "#f59e0b"
        }
      ]
    }
  ];

  if (stats && (stats.globalSpeedIn !== undefined || stats.globalSpeedOut !== undefined)) {
    widgetChildren.push({ type: "spacer", length: 2 });
    widgetChildren.push({
      type: "stack",
      direction: "horizontal",
      children: [
        {
          type: "text",
          text: `↓ ${formatSpeed(stats.globalSpeedIn)}  ↑ ${formatSpeed(stats.globalSpeedOut)}`,
          font: { size: 9, family: "Menlo" },
          textColor: "#71717a"
        }
      ]
    });
  }

  widgetChildren.push({ type: "spacer", length: 6 });

  const displayList = servers.slice(0, displayLimit);

  if (displayList.length === 0) {
    widgetChildren.push({
      type: "text",
      text: "当前分组暂无服务器",
      font: { size: 11 },
      textColor: "#71717a"
    });
  } else {
    for (const s of displayList) {
      const isOnline = (now - (s.last_updated || 0)) < OFFLINE_THRESHOLD_MS;
      const nameStr = s.name.length > 9 ? s.name.substring(0, 8) + "…" : s.name;

      const rowChildren = [
        {
          type: "text",
          text: "● ",
          font: { size: 10 },
          textColor: isOnline ? "#10b981" : "#ef4444"
        },
        {
          type: "text",
          text: `${getFlagEmoji(s.region)} `,
          font: { size: 10 }
        },
        {
          type: "text",
          text: nameStr,
          font: { size: 11 },
          textColor: "#e4e4e7"
        },
        { type: "spacer" }
      ];

      if (isOnline) {
        const cpuVal = Math.round(s.cpu || 0);
        const memVal = Math.round(((s.ram_used || 0) / (s.ram_total || 1)) * 100);
        const netDown = formatSpeed(s.net_in_speed || 0);

        rowChildren.push({
          type: "text",
          text: `C:${cpuVal}% M:${memVal}%  ${netDown}`,
          font: { size: 10, family: "Menlo" },
          textColor: "#a1a1aa"
        });
      } else {
        rowChildren.push({
          type: "text",
          text: "Offline",
          font: { size: 10 },
          textColor: "#ef4444"
        });
      }

      widgetChildren.push({
        type: "stack",
        direction: "horizontal",
        alignItems: "center",
        children: rowChildren
      });

      widgetChildren.push({ type: "spacer", length: 3 });
    }
  }

  return {
    type: "widget",
    backgroundColor: "#16181f",
    padding: [10, 12, 10, 12],
    children: widgetChildren
  };
}
