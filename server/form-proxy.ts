import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin } from "vite"
import { formByCode } from "../src/data/forms"

const MAX_BYTES = 12_000_000

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader("Content-Type", "application/json")
  res.end(JSON.stringify(body))
}

function fileNameFor(code: string) {
  return `${code}-amended-registered-agent.pdf`
}

async function fetchOfficialForm(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "", "http://localhost")
  const code = url.searchParams.get("code")?.toUpperCase() ?? ""
  const form = formByCode(code)

  if (!form) {
    sendJson(res, 404, { error: "Unknown state." })
    return
  }
  if (!form.fileUrl) {
    sendJson(res, 422, {
      error: "This state does not publish a direct form file. Open the official source and upload the PDF.",
    })
    return
  }

  try {
    const upstream = await fetch(form.fileUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
      headers: {
        Accept: "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      },
    })

    if (!upstream.ok) {
      sendJson(res, 502, {
        error: `${form.name} returned ${upstream.status} for the official form.`,
      })
      return
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer())
    if (bytes.byteLength > MAX_BYTES) {
      sendJson(res, 502, { error: "The downloaded file is larger than 12 MB." })
      return
    }

    const signature = String.fromCharCode(...bytes.slice(0, 5))
    if (!signature.startsWith("%PDF")) {
      sendJson(res, 502, {
        error: `${form.name} did not return a PDF. Open the official source and upload the form.`,
      })
      return
    }

    res.statusCode = 200
    res.setHeader("Content-Type", "application/pdf")
    res.setHeader("Content-Disposition", `attachment; filename="${fileNameFor(form.code)}"`)
    res.setHeader("Content-Length", String(bytes.byteLength))
    res.end(bytes)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Download failed."
    sendJson(res, 502, { error: message })
  }
}

function attach(middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }) {
  middlewares.use((req, res, next) => {
    const path = (req.url ?? "").split("?")[0]
    if (path !== "/api/forms/fetch") {
      next()
      return
    }
    void fetchOfficialForm(req, res)
  })
}

export function formFetchPlugin(): Plugin {
  return {
    name: "form-fetch",
    configureServer(server) {
      attach(server.middlewares)
    },
    configurePreviewServer(server) {
      attach(server.middlewares)
    },
  }
}
