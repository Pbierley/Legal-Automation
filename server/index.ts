import { createServer } from "node:http"
import { handleFormRequest } from "./form-proxy.ts"

const port = Number(process.env.PORT) || 10000

const server = createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0]

  if (path === "/health") {
    res.statusCode = 200
    res.setHeader("Content-Type", "text/plain; charset=utf-8")
    res.end("ok")
    return
  }

  if (path === "/api/forms/fetch") {
    void handleFormRequest(req, res)
    return
  }

  res.statusCode = 404
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify({ error: "Not found." }))
})

server.listen(port, () => {
  console.log(`Form proxy listening on ${port}`)
})
