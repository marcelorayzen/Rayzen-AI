export class VoiceRecorder {
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
  ) {}

  async transcribe(audioBuffer: Buffer, mimeType = 'audio/webm'): Promise<string> {
    const ext  = mimeType.includes('mp4') ? 'mp4' : 'webm'
    const blob = new Blob([audioBuffer], { type: mimeType })
    const form = new FormData()
    form.append('file', blob, `audio.${ext}`)

    const res = await fetch(`${this.apiUrl}/voice/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    })

    if (!res.ok) throw new Error(`Transcription failed: ${res.status}`)
    const data = await res.json() as { text: string }
    return data.text
  }
}
