/**
 * Egern Widget: CF-Server-Monitor
 * 支持通过 Egern 环境变量动态配置参数
 * 
 * 环境变量支持 (可在 Egern 脚本界面配置)：
 * - API_URL: 监控端点，例如 https://域名/api (必填)
 * - GROUP: 分组筛选 (可选)，例如 "国外", "国内", 留空或 "all" 显示全部
 * - LIMIT: 显示服务器数量 (可选)，默认 4
 */
/**
 * Egern 原生 Generic Widget: CF-Server-Monitor
 * 适配 Egern DSL 规范，通过 export default async function(ctx) 导出
 */

// 超过 180 秒无心跳视为离线
const OFFLINE_THRESHOLD_MS = 180 * 1000;

// 国家/地区代码转换国旗 Emoji
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

export default async function(ctx) {
  // 1. 读取 Egern 环境变量
  const env = ctx.env || {};
  const apiUrl = (env.API_URL || "").trim();
  const filterGroup = (env.GROUP || "").trim();
  const displayLimit = parseInt(env.LIMIT, 10) || 4;

  // 校验是否设置了 API_URL
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
          text: "请在环境变量中添加：\n名称: API_URL\n值: 你的监控 /api 完整链接",
          font: { size: 11 },
          textColor: "#9ca3af"
        }
      ]
    };
  }

  // 2. 发起网络请求获取数据
  let payload = null;
  try {
    const resp = await ctx.http.get(apiUrl, {
      headers: {
        "User-Agent": "Egern-Monitor/1.0",
        "Accept": "application/json"
      }
    });
    payload = await resp.json();
  } catch (err) {
    return {
      type: "widget",
      backgroundColor: "#16181f",
      padding: 14,
      children: [
        {
          type: "text",
          text: "⚠️ 获取监控数据失败",
          font: { size: 13, weight: "bold" },
          textColor: "#ef4444"
        },
        { type: "spacer", length: 4 },
        {
          type: "text",
          text: String(err?.message || "网络请求超时或链接无法访问"),
          font: { size: 10 },
          textColor: "#71717a"
        }
      ]
    };
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

  // 3. 构建 Header 栏 (标题 + 在线统计)
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

  // 4. 全局实时网速（如果有 stats 字段）
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

  // 5. 渲染服务器列表
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

  // 返回 Egern 原生 Widget DSL 树
  return {
    type: "widget",
    backgroundColor: "#16181f",
    padding: [10, 12, 10, 12],
    children: widgetChildren
  };
}
