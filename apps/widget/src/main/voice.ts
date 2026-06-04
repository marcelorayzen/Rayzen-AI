import FormData from 'form-data'
import fetch from 'node-fetch'

export class VoiceRecorder {
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
  ) {}

  async transcribe(audioBuffer: Buffer, mimeType = 'audio/webm'): Promise<string> {
    const ext = mimeType.includes('mp4') ? 'mp4' : 'webm'
    const form = new FormData()
    form.append('file', audioBuffer, { filename: `audio.${ext}`, contentType: mimeType })

    const res = await fetch(`${this.apiUrl}/voice/transcribe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, ...form.getHeaders() },
      body: form,
    })

    if (!res.ok) throw new Error(`Transcription failed: ${res.status}`)
    const data = await res.json() as { text: string }
    return data.text
  }
}
