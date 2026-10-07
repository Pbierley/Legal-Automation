import { useEffect, useMemo, useRef, useState } from "react"
import { stateForms, type StateForm } from "./data/forms"
import { clearStored, deleteStored, listStored, saveStored, type StoredForm } from "./lib/db"
import { downloadForm } from "./lib/fetchForm"

type Filter = "all" | "stored" | "missing" | "fetchable"

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso))
}

async function assertPdf(blob: Blob) {
  const header = new Uint8Array(await blob.slice(0, 5).arrayBuffer())
  const signature = String.fromCharCode(...header)
  if (!signature.startsWith("%PDF")) {
    throw new Error("That file is not a PDF.")
  }
}

export default function App() {
  const [stored, setStored] = useState<Record<string, StoredForm>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [batch, setBatch] = useState<{ done: number; total: number; label: string } | null>(null)
  const [previewCode, setPreviewCode] = useState<string | null>(null)
  const uploadTarget = useRef<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const inFlight = useRef(new Set<string>())

  useEffect(() => {
    let cancelled = false
    listStored()
      .then((records) => {
        if (cancelled) return
        setStored(Object.fromEntries(records.map((record) => [record.code, record])))
      })
      .catch(() => {
        if (!cancelled) setLoadError("Stored forms could not be read from this browser.")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const storedCount = Object.keys(stored).length
  const storedBytes = Object.values(stored).reduce((sum, record) => sum + record.byteSize, 0)
  const fetchableCount = stateForms.filter((form) => form.fileUrl).length

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return stateForms.filter((form) => {
      const isStored = Boolean(stored[form.code])
      if (filter === "stored" && !isStored) return false
      if (filter === "missing" && isStored) return false
      if (filter === "fetchable" && !form.fileUrl) return false
      if (!needle) return true
      return (
        form.name.toLowerCase().includes(needle) ||
        form.code.toLowerCase().includes(needle) ||
        form.formName.toLowerCase().includes(needle)
      )
    })
  }, [filter, query, stored])

  function clearError(code: string) {
    setErrors((current) => {
      if (!current[code]) return current
      const next = { ...current }
      delete next[code]
      return next
    })
  }

  async function remember(record: StoredForm) {
    await saveStored(record)
    setStored((current) => ({ ...current, [record.code]: record }))
    clearError(record.code)
  }

  async function fetchOne(form: StateForm) {
    if (!form.fileUrl || inFlight.current.has(form.code)) return
    inFlight.current.add(form.code)
    setBusy((current) => ({ ...current, [form.code]: true }))
    clearError(form.code)
    try {
      const { blob, fileName } = await downloadForm(form.code)
      await assertPdf(blob)
      await remember({
        code: form.code,
        formName: form.formName,
        fileName,
        mimeType: "application/pdf",
        byteSize: blob.size,
        fetchedAt: new Date().toISOString(),
        origin: "fetched",
        sourceUrl: form.fileUrl,
        blob,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Fetch failed."
      setErrors((current) => ({ ...current, [form.code]: message }))
    } finally {
      inFlight.current.delete(form.code)
      setBusy((current) => ({ ...current, [form.code]: false }))
    }
  }

  async function fetchAll() {
    const targets = stateForms.filter((form) => form.fileUrl)
    setBatch({ done: 0, total: targets.length, label: "Starting" })
    let done = 0
    const queue = [...targets]

    async function worker() {
      while (queue.length > 0) {
        const form = queue.shift()
        if (!form) return
        setBatch({ done, total: targets.length, label: form.name })
        await fetchOne(form)
        done += 1
        setBatch({ done, total: targets.length, label: form.name })
      }
    }

    await Promise.all([worker(), worker()])
    setBatch(null)
  }

  function beginUpload(code: string) {
    uploadTarget.current = code
    fileInput.current?.click()
  }

  async function onFileChosen(file: File | undefined) {
    const code = uploadTarget.current
    uploadTarget.current = null
    if (!code || !file) return
    const form = stateForms.find((item) => item.code === code)
    if (!form) return
    if (file.type && file.type !== "application/pdf") {
      setErrors((current) => ({ ...current, [code]: "Upload a PDF." }))
      return
    }
    try {
      await assertPdf(file)
      await remember({
        code,
        formName: form.formName,
        fileName: file.name || `${code}-amended-registered-agent.pdf`,
        mimeType: "application/pdf",
        byteSize: file.size,
        fetchedAt: new Date().toISOString(),
        origin: "uploaded",
        sourceUrl: form.sourceUrl,
        blob: file,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed."
      setErrors((current) => ({ ...current, [code]: message }))
    }
  }

  async function remove(code: string) {
    await deleteStored(code)
    setStored((current) => {
      const next = { ...current }
      delete next[code]
      return next
    })
    if (previewCode === code) setPreviewCode(null)
  }

  async function removeAll() {
    if (!storedCount) return
    if (!window.confirm("Remove every stored form from this browser?")) return
    await clearStored()
    setStored({})
    setPreviewCode(null)
  }

  function download(record: StoredForm) {
    const url = URL.createObjectURL(record.blob)
    const link = document.createElement("a")
    link.href = url
    link.download = record.fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  const preview = previewCode ? stored[previewCode] : undefined
  const failedCount = Object.keys(errors).length

  return (
    <div className="page">
      <header className="masthead">
        <div>
          <p className="eyebrow">Legal Automation</p>
          <h1>Amended registered agent forms</h1>
          <p className="lede">
            Fetch the official blank form for each state and keep the PDF in this browser.
            {` ${fetchableCount} states have a direct file.`} The rest can be stored by upload.
          </p>
        </div>
        <dl className="stats">
          <div>
            <dt>Stored</dt>
            <dd>{storedCount} / 50</dd>
          </div>
          <div>
            <dt>Saved</dt>
            <dd>{formatBytes(storedBytes)}</dd>
          </div>
        </dl>
      </header>

      <section className="toolbar" aria-label="Form actions">
        <div className="actions">
          <button type="button" className="primary" onClick={() => void fetchAll()} disabled={Boolean(batch)}>
            {batch ? `Fetching ${batch.done} of ${batch.total}` : "Fetch available forms"}
          </button>
          <button type="button" onClick={() => void removeAll()} disabled={!storedCount || Boolean(batch)}>
            Clear stored
          </button>
        </div>
        {batch ? (
          <div className="progress" aria-live="polite">
            <span style={{ width: `${(batch.done / batch.total) * 100}%` }} />
            <p>Fetching {batch.label}</p>
          </div>
        ) : null}
        <div className="filters">
          <label className="search">
            <span className="sr-only">Search states</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search states or forms"
            />
          </label>
          <div className="chips" role="tablist" aria-label="Filter forms">
            {(
              [
                ["all", "All 50"],
                ["fetchable", `Direct file ${fetchableCount}`],
                ["stored", `Stored ${storedCount}`],
                ["missing", `Not stored ${50 - storedCount}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={filter === id}
                className={filter === id ? "chip selected" : "chip"}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {failedCount > 0 ? (
          <p className="banner">{failedCount} forms could not be fetched. Upload those PDFs from the official source.</p>
        ) : null}
      </section>

      {loading ? <p className="status-line">Loading stored forms…</p> : null}
      {loadError ? <p className="status-line error">{loadError}</p> : null}

      <section className="register" aria-label="State forms">
        <div className="register-head">
          <span>State</span>
          <span>Form</span>
          <span>Stored</span>
          <span>Actions</span>
        </div>
        {visible.length === 0 ? <p className="status-line">No states match that search.</p> : null}
        {visible.map((form) => {
          const record = stored[form.code]
          const isBusy = Boolean(busy[form.code])
          return (
            <article key={form.code} className="row">
              <div className="state-id">
                <strong>{form.code}</strong>
                <span>{form.name}</span>
              </div>
              <div className="form-copy">
                <h2>{form.formName}</h2>
                {form.note ? <p>{form.note}</p> : null}
                {errors[form.code] ? <p className="error">{errors[form.code]}</p> : null}
              </div>
              <div className="stored-meta">
                {record ? (
                  <>
                    <span className="pill">{record.origin === "fetched" ? "Fetched" : "Uploaded"}</span>
                    <span>
                      {formatBytes(record.byteSize)} · {formatWhen(record.fetchedAt)}
                    </span>
                  </>
                ) : (
                  <span className="pill muted">{form.fileUrl ? "Not stored" : "Upload only"}</span>
                )}
              </div>
              <div className="row-actions">
                {form.fileUrl ? (
                  <button type="button" onClick={() => void fetchOne(form)} disabled={isBusy || Boolean(batch)}>
                    {isBusy ? "Fetching…" : record ? "Fetch again" : "Fetch"}
                  </button>
                ) : null}
                {record ? (
                  <>
                    <button type="button" onClick={() => setPreviewCode(form.code)}>
                      Preview
                    </button>
                    <button type="button" onClick={() => download(record)}>
                      Download
                    </button>
                    <button type="button" onClick={() => void remove(form.code)}>
                      Remove
                    </button>
                  </>
                ) : null}
                <button type="button" onClick={() => beginUpload(form.code)}>
                  Upload
                </button>
                <a href={form.sourceUrl} target="_blank" rel="noreferrer">
                  Source
                </a>
              </div>
            </article>
          )
        })}
      </section>

      <footer className="colophon">
        <p>
          Forms stay in this browser’s local storage. They are blank official files for reference, not filled filings
          and not legal advice.
        </p>
      </footer>

      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        accept="application/pdf,.pdf"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          void onFileChosen(file)
        }}
      />

      {preview ? <Preview record={preview} stateName={stateName(preview.code)} onClose={() => setPreviewCode(null)} /> : null}
    </div>
  )
}

function stateName(code: string) {
  return stateForms.find((form) => form.code === code)?.name ?? code
}

function Preview({
  record,
  stateName: name,
  onClose,
}: {
  record: StoredForm
  stateName: string
  onClose: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const next = URL.createObjectURL(record.blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [record])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div className="preview-backdrop" role="presentation" onClick={onClose}>
      <section
        className="preview"
        role="dialog"
        aria-modal="true"
        aria-label={`${name} form preview`}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <p className="eyebrow">{name}</p>
            <h2>{record.formName}</h2>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        {url ? <iframe title={`${name} registered agent form`} src={url} /> : <p>Opening PDF…</p>}
      </section>
    </div>
  )
}
