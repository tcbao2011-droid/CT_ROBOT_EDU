/* =====================================================
   CẦU NỐI CỤC BỘ CT ROBOT EDU
   Chạy trên máy tính đang cắm mạch. Bản web (Netlify) gọi tới đây để
   biên dịch bằng arduino-cli và nạp vào mạch (STM32 Blue Pill / Black Pill /
   Nucleo, ESP32, Arduino). Chỉ lắng nghe 127.0.0.1.

   Chạy:  node server/bridge.js        (hoặc CHAY_CAU_NOI.bat / .sh)
   Biến môi trường:
     CT_BRIDGE_PORT      cổng (mặc định 8765)
     CT_ALLOWED_ORIGINS  danh sách origin được phép, cách nhau dấu phẩy,
                         ví dụ https://ten-cua-ban.netlify.app,https://robot.edu.vn
===================================================== */
import http from "node:http";
import { handleCompile, handleUpload, handlePing } from "./buildServer.js";

const PORT = Number(process.env.CT_BRIDGE_PORT) || 8765;
const EXTRA_ORIGINS = (process.env.CT_ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);

function originAllowed(origin) {
  if (!origin) return false;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return true;
    return u.protocol === "https:" && u.hostname.endsWith(".netlify.app");
  } catch (_) {
    return false;
  }
}

const routes = {
  "/api/ping": handlePing,
  "/api/compile": handleCompile,
  "/api/upload": handleUpload,
};

const server = http.createServer((req, res) => {
  const origin = req.headers.origin;
  if (origin) {
    if (!originAllowed(origin)) {
      res.statusCode = 403;
      res.end("Origin không được phép. Đặt CT_ALLOWED_ORIGINS=" + origin + " rồi chạy lại cầu nối.");
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    // Chrome yêu cầu header này khi trang https gọi tới localhost (Private Network Access).
    res.setHeader("Access-Control-Allow-Private-Network", "true");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  const pathname = (req.url || "").split("?")[0];
  const handler = routes[pathname];
  if (!handler) {
    res.statusCode = 404;
    res.end("Not Found");
    return;
  }
  handler(req, res);
});

server.on("error", error => {
  console.error(error.code === "EADDRINUSE"
    ? `Cổng ${PORT} đang được dùng (có thể cầu nối đã chạy sẵn).`
    : `Lỗi cầu nối: ${error.message}`);
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`CT Robot EDU - cầu nối đang chạy tại http://127.0.0.1:${PORT}`);
  console.log("Giữ cửa sổ này mở, rồi mở trang web CT Robot EDU và bấm \"Biên dịch & Nạp\".");
});
