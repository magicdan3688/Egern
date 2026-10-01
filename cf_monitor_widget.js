/**
 * Egern Widget: CF-Server-Monitor
 * 优化：地区两排严格网格对齐、文案修正(总流量/input/output)、自适应防截断
 * 环境变量支持 (可在 Egern 脚本界面配置)：
 * - API_URL: 监控端点，例如 https://cerha-monitor.cerha3688.com/api (必填)
 * - GROUP: 分组筛选 (可选)，例如 "国外", "国内"，留空或 "all" 显示全部
 * - API_URL: 监控端点，例如 https://域名/ (api会自动补全填域名也行)
 * - LIMIT: 显示服务器数量 (可选)，默认 4
 */

const OFFLINE_THRESHOLD_MS = 300 * 1000;

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

// 短网速
function formatSpeedShort(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return "0";
  const units = ["B", "K", "M", "G"];
  const i = Math.min(Math.floor(Math.log(bytesPerSec) / Math.log(1024)), units.length - 1);
  const v = bytesPerSec / Math.pow(1024, i);
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)}${units[i]}`;
}

// 格式化累计总流量
function formatTraffic(bytes) {
  if (!bytes || bytes <= 0) return "0G";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)}T`;
  return `${gb.toFixed(0)}G`;
}

// 占用率颜色标定
function usageColor(p) {
  return p >= 85 ? "#ef4444" : p >= 60 ? "#f59e0b" : "#10b981";
}

// 构造固定比例的居中列
function col(text, color, flex, size, weight) {
  return {
    type: "stack",
    direction: "column",
    alignItems: "center",
    flex,
    children: [{
      type: "text",
      text,
      font: { size, weight: weight || "regular", family: "Menlo" },
      textColor: color,
      maxLines: 1,
      minScale: 0.55
    }]
  };
}

export default async function(ctx) {
  const env = ctx.env || {};
  const apiUrl = (env.API_URL || "").trim();
  const filterGroup = (env.GROUP || "").trim();
  const limitNum = parseInt(env.LIMIT, 10);
  const displayLimit = Number.isNaN(limitNum) ? 4 : Math.max(0, limitNum);
  const showRegions = String(env.REGIONS || "1").trim() !== "0";

  if (!apiUrl) {
    return {
      type: "widget",
      backgroundColor: "#16181f",
      padding: 12,
      children: [
        { type: "text", text: "⚠️ 未配置 API_URL", font: { size: 12, weight: "bold" }, textColor: "#ef4444" }
      ]
    };
  }

  const url = normalizeApiUrl(apiUrl);
  const headers = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)",
    "Accept": "application/json"
  };
  const token = (env.TOKEN || "").trim();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let payload = null;
  try {
    const resp = await ctx.http.get(url, { headers });
    payload = await resp.json();
  } catch (err) {
    return {
      type: "widget",
      backgroundColor: "#16181f",
      padding: 12,
      children: [
        { type: "text", text: "⚠️ 获取数据失败", font: { size: 12, weight: "bold" }, textColor: "#ef4444" }
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

  // 1. 顶部 Header
  const widgetChildren = [
    {
      type: "stack",
      direction: "row",
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

  // 2. 网速与总流量行 (总流改为总流量)
  if (stats) {
    widgetChildren.push({ type: "spacer", length: 1 });
    const subHeaderChildren = [];

    if (stats.globalSpeedIn !== undefined || stats.globalSpeedOut !== undefined) {
      subHeaderChildren.push({
        type: "text",
        text: `↓ ${formatSpeed(stats.globalSpeedIn)}  ↑ ${formatSpeed(stats.globalSpeedOut)}`,
        font: { size: 9, family: "Menlo" },
        textColor: "#71717a"
      });
    }

    subHeaderChildren.push({ type: "spacer" });

    if (stats.globalNetRx !== undefined || stats.globalNetTx !== undefined) {
      const rxStr = formatTraffic(stats.globalNetRx);
      const txStr = formatTraffic(stats.globalNetTx);
      subHeaderChildren.push({
        type: "text",
        text: `总流量: ↓${rxStr} ↑${txStr}`,
        font: { size: 9, family: "Menlo" },
        textColor: "#71717a"
      });
    }

    widgetChildren.push({
      type: "stack",
      direction: "row",
      alignItems: "center",
      children: subHeaderChildren
    });
  }

  widgetChildren.push({ type: "spacer", length: 4 });

  // 3. 地区汇总行（每个格子固定 44 宽，保证上下两排国旗垂直对齐）
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
    const REGION_ITEM_W = 44; // 固定每格宽度，解决两位数数字导致的错位

    for (let i = 0; i < regionList.length; i += PER_ROW) {
      const rowChildren = [];
      const currentGroup = regionList.slice(i, i + PER_ROW);

      for (let j = 0; j < PER_ROW; j++) {
        if (j < currentGroup.length) {
          const [code, r] = currentGroup[j];
          const allUp = r.online === r.total;
          const countText = allUp ? `${r.total}` : `${r.online}/${r.total}`;

          rowChildren.push({
            type: "stack",
            direction: "row",
            alignItems: "center",
            width: REGION_ITEM_W,
            children: [
              {
                type: "text",
                text: getFlagEmoji(code === "??" ? "" : code),
                font: { size: 10 }
              },
              { type: "spacer", length: 2 },
              {
                type: "text",
                text: countText,
                font: { size: 9, weight: "medium", family: "Menlo" },
                textColor: allUp ? "#a1a1aa" : (r.online === 0 ? "#ef4444" : "#f59e0b")
              }
            ]
          });
        } else {
          // 不足 4 个时补空白槽位占位
          rowChildren.push({
            type: "stack",
            width: REGION_ITEM_W
          });
        }
      }

      rowChildren.push({ type: "spacer" });

      widgetChildren.push({
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: rowChildren
      });
      widgetChildren.push({ type: "spacer", length: 1 });
    }
    widgetChildren.push({ type: "spacer", length: 3 });
  }

  // 4. 节点列表参数配置
  const DOT_W = 9;
  const FLAG_W = 16;
  // 适当加大 input 和 output 列的权重
  const F = { name: 26, cpu: 11, mem: 11, disk: 11, down: 20, up: 21 };

  const displayList = servers.slice(0, displayLimit);

  if (displayLimit > 0 && displayList.length > 0) {
    widgetChildren.push({
      type: "stack",
      direction: "row",
      alignItems: "center",
      children: [
        { type: "stack", direction: "row", width: DOT_W + FLAG_W },
        { type: "stack", direction: "column", alignItems: "start", flex: F.name },
        col("CPU", "#71717a", F.cpu, 8, "bold"),
        col("MEM", "#71717a", F.mem, 8, "bold"),
        col("DISK", "#71717a", F.disk, 8, "bold"),
        col("↓input", "#71717a", F.down, 8, "bold"),
        col("↑output", "#71717a", F.up, 8, "bold")
      ]
    });
    widgetChildren.push({ type: "spacer", length: 1 });
  }

  // 5. 服务器列表行
  for (const s of displayList) {
    const isOnline = (now - (s.last_updated || 0)) < OFFLINE_THRESHOLD_MS;

    const rowChildren = [
      {
        type: "stack",
        direction: "column",
        alignItems: "start",
        width: DOT_W,
        children: [{
          type: "text",
          text: "●",
          font: { size: 8 },
          textColor: isOnline ? "#10b981" : "#ef4444"
        }]
      },
      {
        type: "stack",
        direction: "column",
        alignItems: "center",
        width: FLAG_W,
        children: [{
          type: "text",
          text: getFlagEmoji(s.region),
          font: { size: 9 }
        }]
      },
      {
        type: "stack",
        direction: "column",
        alignItems: "start",
        flex: F.name,
        children: [{
          type: "text",
          text: s.name || "-",
          font: { size: 10, weight: "medium" },
          textColor: "#e4e4e7",
          maxLines: 1,
          minScale: 0.65
        }]
      }
    ];

    if (isOnline) {
      const cpuP = Math.round(s.cpu || 0);
      const memP = Math.round(((s.ram_used || 0) / (s.ram_total || 1)) * 100);
      const hasDisk = (s.disk_total || 0) > 0;
      const diskP = hasDisk ? Math.round(((s.disk_used || 0) / s.disk_total) * 100) : 0;

      rowChildren.push(col(`${cpuP}%`, usageColor(cpuP), F.cpu, 9));
      rowChildren.push(col(`${memP}%`, usageColor(memP), F.mem, 9));
      rowChildren.push(hasDisk 
        ? col(`${diskP}%`, usageColor(diskP), F.disk, 9) 
        : col("--", "#71717a", F.disk, 9)
      );
      rowChildren.push(col(formatSpeedShort(s.net_in_speed), "#a1a1aa", F.down, 9));
      rowChildren.push(col(formatSpeedShort(s.net_out_speed), "#a1a1aa", F.up, 9));
    } else {
      rowChildren.push({ type: "spacer" });
      rowChildren.push({
        type: "text",
        text: "Offline",
        font: { size: 9, weight: "medium" },
        textColor: "#ef4444"
      });
    }

    widgetChildren.push({
      type: "stack",
      direction: "row",
      alignItems: "center",
      children: rowChildren
    });

    widgetChildren.push({ type: "spacer", length: 2 });
  }

  return {
    type: "widget",
    backgroundColor: "#16181f",
    padding: [8, 12, 8, 12],
    children: widgetChildren
  };
}
