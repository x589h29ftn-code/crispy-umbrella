// Externe conversiegereedschappen (LibreOffice, tesseract, pdftoppm) draaien op
// bestanden die van buiten komen. Dit is de gemeenschappelijke manier waarop ze
// worden aangeroepen.
//
// WEES PRECIES OVER WAT DIT IS. Dit is géén sandbox in de zin van een namespace,
// seccomp-profiel of aparte gebruiker. Het is:
//
//   - een eigen tijdelijke map als werkmap én als HOME, die daarna wordt verwijderd;
//   - een uitgeklede omgeving: geen proxyvariabelen, geen tokens, geen
//     databasewachtwoord, geen sleutels — een proces dat toch naar buiten wil, komt
//     er niet langs de proxy en heeft niets om mee te nemen;
//   - een harde tijdslimiet;
//   - een limiet op de hoeveelheid uitvoer.
//
// Wat dit NIET is: netwerktoegang blokkeren. De webcontainer heeft netwerk nodig
// (sealer, SMTP, provider-API's) en deze processen draaien in diezelfde container.
// Wie dat echt dicht wil, moet de conversie in een eigen container zetten met
// `network_mode: none`. Dat staat als bekende beperking in docs/beheer.md.

import { execFile } from 'node:child_process'
import type { ExecFileException } from 'node:child_process'

/** Variabelen die een extern proces nooit nodig heeft. */
const GEHEIMEN = /(SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL|API|SMTP|POSTMARK|RESEND|TWILIO|MESSAGEBIRD|CLEVERBASE|DIGIDENTITY|SHAREPOINT|AUTH)/i

/**
 * Bouwt een minimale omgeving voor een extern proces: alleen wat nodig is om te
 * kunnen draaien, en niets waarmee het naar buiten kan of iets kan meenemen.
 */
export function schoneOmgeving(home: string, extra?: Record<string, string>): Record<string, string> {
  const basis: Record<string, string> = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    TMPDIR: home,
    LANG: process.env.LANG ?? 'C.UTF-8',
    LC_ALL: process.env.LC_ALL ?? 'C.UTF-8'
  }
  // Expliciet leeg: anders erft het kindproces de proxy van de container en kan een
  // document dat naar buiten wil dat alsnog via de proxy doen.
  for (const naam of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'NO_PROXY']) {
    basis[naam] = ''
  }
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (GEHEIMEN.test(k)) continue
    basis[k] = v
  }
  return basis
}

export interface RunResult {
  stdout: string
  stderr: string
}

/**
 * Voert een extern gereedschap uit met een tijdslimiet, een uitvoerlimiet en een
 * uitgeklede omgeving.
 */
export function runTool(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; maxOutputBytes?: number; env?: Record<string, string> }
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        // Een gereedschap dat eindeloos naar stderr schrijft mag het geheugen niet
        // opvreten; execFile kapt af en meldt dat.
        maxBuffer: opts.maxOutputBytes ?? 8 * 1024 * 1024,
        // De typedefinitie van ProcessEnv eist NODE_ENV; die hoort niet bij deze
        // gereedschappen, dus de cast is hier juist en niet een omzeiling.
        env: schoneOmgeving(opts.cwd, opts.env) as NodeJS.ProcessEnv,
        killSignal: 'SIGKILL'
      },
      (error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) =>
        error ? reject(error) : resolve({ stdout: String(stdout), stderr: String(stderr) })
    )
  })
}
