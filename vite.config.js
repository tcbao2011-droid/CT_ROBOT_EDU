import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { handleCompile, handleUpload, handlePing } from "./server/buildServer.js";

function buildApi() {
  return {
    name: "ct-robot-build-api",
    configureServer(server) {
      server.middlewares.use("/api/ping", handlePing);
      server.middlewares.use("/api/compile", handleCompile);
      server.middlewares.use("/api/upload", handleUpload);
    },
  };
}

export default defineConfig({
  plugins: [react(), buildApi()],
});
