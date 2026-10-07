export async function downloadForm(code: string): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(`/api/forms/fetch?code=${encodeURIComponent(code)}`)
  if (!response.ok) {
    let message = `Could not fetch this form (${response.status}).`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* response was not JSON */
    }
    throw new Error(message)
  }

  const disposition = response.headers.get("Content-Disposition") ?? ""
  const match = disposition.match(/filename="([^"]+)"/)
  const blob = await response.blob()
  return { blob, fileName: match?.[1] ?? `${code}-amended-registered-agent.pdf` }
}
