import 'server-only'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from '@/env'

// Archiveert de definitieve, getekende PDF's automatisch in de klantmap.
// Drivers: 'none' (uit), 'folder' (naar een gekoppelde map/volume) en
// 'sharepoint' (Microsoft 365 via Graph). Best-effort: een mislukking mag het
// afronden van een dossier nooit blokkeren (de aanroeper vangt fouten af).

export interface ArchiveFile {
  filename: string
  content: Buffer
}
export interface ArchiveInput {
  folder: string // relatief pad in het archief, mag mappen bevatten (met '/')
  files: ArchiveFile[]
}
export interface ArchiveResult {
  archived: number
  driver: string
  target?: string
}

/** Maakt één naamdeel veilig voor gebruik als map- of bestandsnaam.
 * Neutraliseert padtraversal ('.', '..' en leidende punten) zodat een
 * ingestelde map nooit buiten de archiefmap of -bibliotheek kan wijzen. */
function safeSegment(s: string): string {
  const cleaned = (s || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '') // verwijder leidende punten ('.', '..', verborgen bestanden)
    .trim()
    .slice(0, 120)
  return cleaned
}
/** Splitst een pad op '/', maakt elk deel veilig en laat lege delen weg. */
function safeSegments(path: string): string[] {
  return path.split('/').map(safeSegment).filter(Boolean)
}

/**
 * Bouwt de standaardbestemming: <klantmap>/<boekjaar>. De klantmap is de
 * ingestelde archiefmap van de klant, of anders "<klantnummer> - <naam>".
 */
export function buildDefaultFolder(opts: {
  clientBaseFolder?: string | null
  clientName: string
  clientNumber?: string | null
  year?: number | null
}): string {
  const base = (opts.clientBaseFolder ?? '').trim() || (opts.clientNumber?.trim() ? `${opts.clientNumber.trim()} - ${opts.clientName}` : opts.clientName)
  return opts.year ? `${base}/${opts.year}` : base
}

export function archiveEnabled(): boolean {
  return env.ARCHIVE_DRIVER !== 'none'
}

/** Schrijft de bestanden naar `<ARCHIVE_DIR>/<folder>/`. */
async function archiveToFolder(input: ArchiveInput): Promise<ArchiveResult> {
  const dir = join(env.ARCHIVE_DIR, ...safeSegments(input.folder))
  await mkdir(dir, { recursive: true })
  for (const f of input.files) await writeFile(join(dir, safeSegment(f.filename)), f.content)
  return { archived: input.files.length, driver: 'folder', target: dir }
}

/** Haalt een app-token op via de client-credentials-stroom (Microsoft Graph). */
async function graphToken(): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.SHAREPOINT_CLIENT_ID ?? '',
    client_secret: env.SHAREPOINT_CLIENT_SECRET ?? '',
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  })
  const res = await fetch(`https://login.microsoftonline.com/${env.SHAREPOINT_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!res.ok) throw new Error(`token ${res.status}`)
  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) throw new Error('geen access_token')
  return data.access_token
}

/** Uploadt de bestanden naar een SharePoint-documentbibliotheek (Graph). */
async function archiveToSharePoint(input: ArchiveInput): Promise<ArchiveResult> {
  const drive = env.SHAREPOINT_DRIVE_ID
  if (!drive || !env.SHAREPOINT_TENANT_ID || !env.SHAREPOINT_CLIENT_ID || !env.SHAREPOINT_CLIENT_SECRET) {
    throw new Error('SharePoint-configuratie onvolledig')
  }
  const token = await graphToken()
  const baseSegs = env.SHAREPOINT_BASE_FOLDER ? safeSegments(env.SHAREPOINT_BASE_FOLDER) : []
  const folderSegs = [...baseSegs, ...safeSegments(input.folder)]
  // Een PUT naar een pad maakt ontbrekende tussenmappen automatisch aan.
  for (const f of input.files) {
    const path = [...folderSegs, safeSegment(f.filename)].map(encodeURIComponent).join('/')
    const res = await fetch(`https://graph.microsoft.com/v1.0/drives/${drive}/root:/${path}:/content`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' },
      body: f.content as unknown as BodyInit
    })
    if (!res.ok) throw new Error(`upload ${res.status}`)
  }
  return { archived: input.files.length, driver: 'sharepoint', target: folderSegs.join('/') }
}

/** Archiveert de getekende stukken volgens de geconfigureerde driver. */
export async function archiveDossier(input: ArchiveInput): Promise<ArchiveResult> {
  if (input.files.length === 0) return { archived: 0, driver: env.ARCHIVE_DRIVER }
  switch (env.ARCHIVE_DRIVER) {
    case 'folder':
      return archiveToFolder(input)
    case 'sharepoint':
      return archiveToSharePoint(input)
    default:
      return { archived: 0, driver: 'none' }
  }
}
