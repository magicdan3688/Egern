/**
 * Egern Widget: CF-Server-Monitor
 * 支持通过 Egern 环境变量动态配置参数
 * 
 * 环境变量支持 (可在 Egern 脚本界面配置)：
 * - API_URL: 探针站点地址 (必填)，例如 https://域名 或 https://域名/api/servers
 *            (只填域名也可以，脚本会自动补全为 /api/servers)
 * - TOKEN: 管理员 JWT (可选)。仅当站点设为"私有"时需要，7 天过期
 * - GROUP: 分组筛选 (可选)，例如 "国外", "国内", 留空或 "all" 显示全部
 * - LIMIT: 显示服务器数量 (可选)，默认 4；填 0 则只显示地区汇总
 * - REGIONS: 填 0 可隐藏地区汇总 (可选)，默认显示
 */

// 1. 读取环境变量 (兼容 ctx.env、全局 $env 及默认值)
const OFFLINE_THRESHOLD_MS = 300 * 1000; // 与探针后端一致：5 分钟无上报视为离线

// 国家/地区代码转换国旗 Emoji
function getFlagEmoji(region) {
  if (!region || region.length !== 2) return "🌐";
  const codePoints = region
    .toUpperCase()
    .split("")
    .map(c => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

// 自动补全为 /api/servers
function normalizeApiUrl(raw) {
  const u = raw.trim().replace(/\/+$/, "");
  if (/\/api\/servers$/.test(u)) return u;
  if (/\/api$/.test(u)) return u + "/servers";
  return u + "/api/servers";
}

// 格式化网速
function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return "0 B/s";
  const units = ["B/s", "K/s", "M/s", "G/s"];
  const i = Math.floor(Math.log(bytesPerSec) / Math.log(1024));
  const val = (bytesPerSec / Math.pow(1024, i)).toFixed(1);
  return `${val}${units[i]}`;
}

export default async function(ctx) {
  // 1. 从 ctx.env 获取在环境变量里填写的配置
  const env = ctx.env || {};
  const apiUrl = (env.API_URL || "").trim();
  const filterGroup = (env.GROUP || "").trim();
  const limitNum = parseInt(env.LIMIT, 10);
  const displayLimit = Number.isNaN(limitNum) ? 4 : Math.max(0, limitNum);
  const showRegions = String(env.REGIONS || "1").trim() !== "0";

  // 校验是否配置了 API_URL
  if (!apiUrl) {
    return {
      type: "widget",
      backgroundColor: "#16181f",
      padding: 14,
      children: [
        {
          type: "text",
          text: "⚠️ 未配置 API_URL",
          font: { size: 13, weight: "bold" },
          textColor: "#ef4444"
        },
        { type: "spacer", length: 6 },
        {
          type: "text",
          text: "请在 Egern 环境变量添加：\n名称: API_URL\n值: 你的探针/api地址",
          font: { size: 11 },
          textColor: "#9ca3af"
        }
      ]
    };
  }

  // 2. 发起网络请求获取监控数据
  const url = normalizeApiUrl(apiUrl);
  const headers = {
    "User-Agent": "Egern-Monitor/1.0",
    "Accept": "application/json"
  };
  const token = (env.TOKEN || "").trim();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const errorWidget = (title, detail) => ({
    type: "widget",
    backgroundColor: "#16181f",
    padding: 14,
    children: [
      { type: "text", text: title, font: { size: 13, weight: "bold" }, textColor: "#ef4444" },
      { type: "spacer", length: 4 },
      { type: "text", text: detail, font: { size: 10 }, textColor: "#71717a" }
    ]
  });

  let payload = null;
  try {
    const resp = await ctx.http.get(url, { headers });
    const status = resp.status;
    if (status && status !== 200) {
      if (status === 401) {
        return errorWidget("🔒 站点为私有 (401)", "请在后台把站点设为公开，或在环境变量添加 TOKEN (管理员 JWT)");
      }
      return errorWidget(`⚠️ 请求失败 HTTP ${status}`, url);
    }
    const text = await resp.text();
    try {
      payload = JSON.parse(text);
    } catch (e) {
      return errorWidget("⚠️ 返回的不是 JSON", `${url}\n${text.slice(0, 60)}`);
    }
  } catch (err) {
    return errorWidget("⚠️ 获取探针数据失败", `${url}\n${String(err?.message || err)}`);
  }

  if (payload && payload.error) {
    return errorWidget("⚠️ 探针返回错误", String(payload.error));
  }

  let servers = payload.servers || [];
  const stats = payload.stats;
  const now = Date.now();

  // 若填写了分组筛选
  if (filterGroup && filterGroup.toLowerCase() !== "all") {
    servers = servers.filter(s => s.server_group === filterGroup);
  }

  const total = servers.length;
  const online = servers.filter(s => (now - (s.last_updated || 0)) < OFFLINE_THRESHOLD_MS).length;

  const titleText = filterGroup && filterGroup.toLowerCase() !== "all" 
    ? `⚡ ${filterGroup}` 
    : "⚡ 节点监控";

  // 3. 构建 Header 栏 (标题 + 在线数)
  const headerChildren = [
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
  ];

  const widgetChildren = [
    {
      type: "stack",
      direction: "row",
      alignItems: "center",
      children: headerChildren
    }
  ];

  // 4. 全局实时吞吐量展示 (如果 stats 存在)
  if (stats && (stats.globalSpeedIn !== undefined || stats.globalSpeedOut !== undefined)) {
    widgetChildren.push({ type: "spacer", length: 2 });
    widgetChildren.push({
      type: "stack",
      direction: "row",
      children: [
        {
          type: "text",
          text: `↓ ${formatSpeed(stats.globalSpeedIn)}  ↑ ${formatSpeed(stats.globalSpeedOut)}`,
          font: { size: 9 },
          textColor: "#71717a"
        }
      ]
    });
  }

  widgetChildren.push({ type: "spacer", length: 6 });

  // 地区分布汇总：国旗 + 在线数/总数（有节点离线时标红）
  if (showRegions && servers.length > 0) {
    const regionMap = {};
    for (const s of servers) {
      const code = (s.region || "").toUpperCase();
      const key = code.length === 2 && code !== "XX" ? code : "??";
      if (!regionMap[key]) regionMap[key] = { total: 0, online: 0 };
      regionMap[key].total += 1;
      if ((now - (s.last_updated || 0)) < OFFLINE_THRESHOLD_MS) regionMap[key].online += 1;
    }
    const regionList = Object.entries(regionMap)
      .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
      .slice(0, 8);

    const PER_ROW = 4;
    for (let i = 0; i < regionList.length; i += PER_ROW) {
      const rowItems = regionList.slice(i, i + PER_ROW).map(([code, r]) => {
        const allUp = r.online === r.total;
        return {
          type: "text",
          text: `${getFlagEmoji(code === "??" ? "" : code)} ${allUp ? r.total : `${r.online}/${r.total}`}`,
          font: { size: 10, weight: "medium" },
          textColor: allUp ? "#a1a1aa" : (r.online === 0 ? "#ef4444" : "#f59e0b")
        };
      });
      const children = [];
      rowItems.forEach((item, idx) => {
        if (idx > 0) children.push({ type: "spacer", length: 10 });
        children.push(item);
      });
      children.push({ type: "spacer" });
      widgetChildren.push({
        type: "stack",
        direction: "row",
        alignItems: "center",
        children
      });
      widgetChildren.push({ type: "spacer", length: 2 });
    }
    widgetChildren.push({ type: "spacer", length: 4 });
  }

  // 5. 渲染服务器列表
  const displayList = servers.slice(0, displayLimit);

  if (displayLimit === 0) {
    // 仅地区汇总，不渲染服务器列表
  } else if (displayList.length === 0) {
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
        // 状态圆点
        {
          type: "text",
          text: "● ",
          font: { size: 10 },
          textColor: isOnline ? "#10b981" : "#ef4444"
        },
        // 国旗
        {
          type: "text",
          text: `${getFlagEmoji(s.region)} `,
          font: { size: 10 }
        },
        // 节点名称
        {
          type: "text",
          text: nameStr,
          font: { size: 11 },
          textColor: "#e4e4e7"
        },
        { type: "spacer" }
      ];

      // 在线时显示性能指标；离线时显示 Offline
      if (isOnline) {
        const cpuVal = Math.round(s.cpu || 0);
        const memVal = Math.round(((s.ram_used || 0) / (s.ram_total || 1)) * 100);
        const netDown = formatSpeed(s.net_in_speed || 0);

        rowChildren.push({
          type: "text",
          text: `C:${cpuVal}% M:${memVal}%  ${netDown}`,
          font: { size: 10 },
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
        direction: "row",
        alignItems: "center",
        children: rowChildren
      });

      widgetChildren.push({ type: "spacer", length: 3 });
    }
  }

  // 返回 Egern 原生 Widget DSL 结构
  return {
    type: "widget",
    backgroundColor: "#16181f",
    padding: [10, 12, 10, 12],
    children: widgetChildren
  };
}
