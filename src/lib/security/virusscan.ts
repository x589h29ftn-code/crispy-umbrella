import 'server-only'
import net from 'node:net'
import { env } from '@/env'

// Optionele virusscan op geüploade bestanden via een ClamAV-daemon (clamd).
// Fail-closed: staat scannen aan maar is clamd onbereikbaar of geeft een fout,
// dan wordt het bestand geweigerd (niet stilzwijgend doorgelaten).

export interface ScanVerdict {
  clean: boolean
  virus?: string
}

export function scanEnabled(): boolean {
  return env.VIRUS_SCAN === 'clamav'
}

/** Interpreteert het antwoord van clamd (INSTREAM). Pure functie (testbaar). */
export function parseClamResponse(raw: string): ScanVerdict {
  const line = raw.replace(/\0/g, '').trim()
  if (/\bOK$/.test(line)) return { clean: true }
  const found = line.match(/stream:\s*(.+)\s+FOUND$/i)
  if (found) return { clean: false, virus: found[1] }
  throw new Error(`onverwacht clamd-antwoord: ${line || '(leeg)'}`)
}

/** Stuurt de bytes naar clamd via het INSTREAM-protocol. */
function clamdInstream(buffer: Buffer): Promise<ScanVerdict> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: env.CLAMD_HOST, port: env.CLAMD_PORT })
    const chunks: Buffer[] = []
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      socket.destroy()
      fn()
    }
    socket.setTimeout(30_000)
    socket.on('timeout', () => done(() => reject(new Error('clamd timeout'))))
    socket.on('error', (e) => done(() => reject(e)))
    socket.on('data', (d) => chunks.push(d))
    socket.on('end', () =>
      done(() => {
        try {
          resolve(parseClamResponse(Buffer.concat(chunks).toString('utf8')))
        } catch (e) {
          reject(e as Error)
        }
      })
    )
    socket.on('connect', () => {
      socket.write('zINSTREAM\0')
      // Stuur in blokken van maximaal 64 kB: [4-byte lengte][data], afsluiten met lengte 0.
      const CHUNK = 64 * 1024
      for (let i = 0; i < buffer.length; i += CHUNK) {
        const slice = buffer.subarray(i, i + CHUNK)
        const len = Buffer.alloc(4)
        len.writeUInt32BE(slice.length, 0)
        socket.write(len)
        socket.write(slice)
      }
      const zero = Buffer.alloc(4)
      zero.writeUInt32BE(0, 0)
      socket.write(zero)
    })
  })
}

/**
 * Scant een buffer. Bij uitgeschakelde scan altijd 'clean'. Bij ingeschakelde
 * scan wordt een fout doorgegooid (fail-closed) zodat de aanroeper de upload
 * kan weigeren.
 */
export async function scanBuffer(buffer: Uint8Array | Buffer): Promise<ScanVerdict> {
  if (!scanEnabled()) return { clean: true }
  return clamdInstream(Buffer.from(buffer))
}
