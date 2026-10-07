import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { formFetchPlugin } from "./server/form-proxy"

export default defineConfig({
  base: process.env.VITE_BASE || "/",
  plugins: [react(), formFetchPlugin()],
  server: {
    port: 5173,
  },
})
