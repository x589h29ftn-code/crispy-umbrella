import { app } from 'electron'
import { join } from 'path'
import { readFile, unlink, writeFile } from 'fs/promises'

const FOLDER_NAME = 'PDF Studio'

function tokenPath(): string {
  return join(app.getPath('userData'), 'remarkable.json')
}

async function readDeviceToken(): Promise<string | null> {
  try {
    const raw = await readFile(tokenPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return typeof parsed.deviceToken === 'string' && parsed.deviceToken ? parsed.deviceToken : null
  } catch {
    return null
  }
}

export async function remarkableStatus(): Promise<{ paired: boolean }> {
  return { paired: (await readDeviceToken()) !== null }
}

/** Wisselt de eenmalige koppelcode in voor een blijvend device-token en bewaart dat lokaal. */
export async function remarkablePair(code: string): Promise<{ ok: boolean; error?: string }> {
  const clean = code.trim().replace(/\s+/g, '').toLowerCase()
  if (clean.length < 6) return { ok: false, error: 'Voer de volledige koppelcode in' }
  try {
    const { register } = await import('rmapi-js')
    const deviceToken = await register(clean, { deviceDesc: 'desktop-windows' })
    await writeFile(tokenPath(), JSON.stringify({ deviceToken }), 'utf-8')
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // De code kan verlopen/al gebruikt zijn, of er is geen netwerk.
    return { ok: false, error: `Koppelen mislukt: ${message}` }
  }
}

export async function remarkableUnpair(): Promise<{ ok: boolean }> {
  await unlink(tokenPath()).catch(() => undefined)
  return { ok: true }
}

/** Uploadt een PDF naar de map "PDF Studio" op reMarkable (map wordt aangemaakt als hij ontbreekt). */
export async function remarkableUpload(
  name: string,
  data: Uint8Array
): Promise<{ ok: boolean; error?: string }> {
  const deviceToken = await readDeviceToken()
  if (!deviceToken) return { ok: false, error: 'Nog niet gekoppeld met reMarkable' }
  try {
    const { remarkable } = await import('rmapi-js')
    const api = await remarkable(deviceToken)

    // Bestaande "PDF Studio"-map in de hoofdmap zoeken, anders aanmaken.
    const items = await api.listItems()
    const existing = items.find(
      (item) =>
        item.type === 'CollectionType' &&
        item.visibleName === FOLDER_NAME &&
        (item.parent === '' || item.parent === undefined)
    )
    const folderId = existing ? existing.id : (await api.putFolder(FOLDER_NAME)).id

    await api.putPdf(name, new Uint8Array(data), { parent: folderId })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Uploaden naar reMarkable is mislukt: ${message}` }
  }
}
