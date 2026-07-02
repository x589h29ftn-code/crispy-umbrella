import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { Recipe, recrypt } from 'muhammara'

// Sum of all Recipe#permission() flags (print, modify, copy, edit, fillform,
// extract, assemble, printbest) per the PDF 32000-1:2008 permission bits.
// Hardcoded because muhammara's type definitions don't declare `permission()`.
const FULL_PERMISSIONS = 3900

export async function encryptPdfBuffer(data: Uint8Array, password: string): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'pdf-studio-'))
  const inputPath = join(dir, 'input.pdf')
  const outputPath = join(dir, 'output.pdf')

  try {
    await writeFile(inputPath, Buffer.from(data))

    new Recipe(inputPath, outputPath)
      .encrypt({ userPassword: password, ownerPassword: password, userProtectionFlag: FULL_PERMISSIONS })
      .endPDF()

    return await readFile(outputPath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/**
 * Strips the encryption from a password-protected PDF so the renderer can
 * work with plain bytes. Throws if the password is wrong.
 */
export async function decryptPdfBuffer(data: Uint8Array, password: string): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'pdf-studio-'))
  const inputPath = join(dir, 'input.pdf')
  const outputPath = join(dir, 'output.pdf')

  try {
    await writeFile(inputPath, Buffer.from(data))
    recrypt(inputPath, outputPath, { password })
    return await readFile(outputPath)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
