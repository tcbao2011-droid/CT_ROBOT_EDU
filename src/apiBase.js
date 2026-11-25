/* Xác định nơi gọi API biên dịch/nạp:
   - Chạy `npm run dev`: cùng origin (/api/...).
   - Bản đưa lên Netlify: cầu nối cục bộ http://127.0.0.1:8765 (server/bridge.js). */
const DEFAULT_BRIDGE = "http://127.0.0.1:8765";
const KEY = "ctrobot.bridgeUrl";

export function getBridgeUrl() {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved) return saved.replace(/\/$/, "");
  } catch (_) {}
  return DEFAULT_BRIDGE;
}

async function ping(base) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${base}/api/ping`, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return false;
    const data = await response.json();
    return data?.app === "ct-robot-bridge";
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export const BRIDGE_MISSING_MESSAGE =
  "Chưa kết nối được cầu nối nạp code. Trên máy đang cắm mạch, hãy chạy CHAY_CAU_NOI.bat (Windows) "
  + "hoặc CHAY_CAU_NOI.sh (macOS/Linux) và giữ cửa sổ đó mở, rồi bấm nạp lại. "
  + "Cần cài sẵn arduino-cli (xem README).";

/** Trả về base URL ("" = cùng origin) hoặc ném lỗi hướng dẫn nếu không có máy chủ nào. */
export async function resolveApiBase() {
  if (await ping("")) return "";
  const bridge = getBridgeUrl();
  if (await ping(bridge)) return bridge;
  throw new Error(BRIDGE_MISSING_MESSAGE);
}
