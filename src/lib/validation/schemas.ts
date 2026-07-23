import { z } from 'zod'

const email = z.string().email('Ongeldig e-mailadres').max(200)
const naam = z.string().trim().min(1, 'Verplicht').max(200)

export const clientSchema = z.object({
  displayName: naam,
  clientNumber: z.string().trim().max(40).optional().or(z.literal('')),
  companyName: z.string().trim().max(200).optional().or(z.literal('')),
  contactName: z.string().trim().max(200).optional().or(z.literal('')),
  firstName: z.string().trim().max(100).optional().or(z.literal('')),
  email: z.string().email().max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(60).optional().or(z.literal('')),
  kvk: z.string().trim().max(20).optional().or(z.literal('')),
  address: z.string().trim().max(200).optional().or(z.literal('')),
  postalCode: z.string().trim().max(16).optional().or(z.literal('')),
  city: z.string().trim().max(120).optional().or(z.literal('')),
  country: z.string().trim().max(80).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  archiveFolder: z.string().trim().max(300).optional().or(z.literal('')),
  verificationMethod: z.enum(['EMAIL', 'SMS']).default('EMAIL')
})
export type ClientInput = z.infer<typeof clientSchema>

export const dossierCreateSchema = z.object({
  title: naam,
  message: z.string().trim().max(2000).optional().or(z.literal('')),
  linkTtlDays: z.coerce.number().int().min(1).max(90).default(10)
})

export const placementSchema = z.object({
  documentId: z.string().cuid(),
  page: z.number().int().min(0),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive()
})

export const signerInputSchema = z.object({
  // 'office' = kantoorgebruiker (tekent in het portaal), 'client' = externe cliënt.
  kind: z.enum(['office', 'client']),
  name: naam,
  email,
  phone: z.string().trim().max(60).optional().nullable(),
  clientId: z.string().cuid().optional().nullable(),
  accountantId: z.string().cuid().optional().nullable(),
  verificationMethod: z.enum(['EMAIL', 'SMS']).default('EMAIL'),
  fields: z.array(placementSchema).min(1, 'Plaats minstens één tekenveld voor deze ondertekenaar')
})

export const saveFieldsSchema = z.object({
  signingMode: z.enum(['PARALLEL', 'SEQUENTIAL']).default('PARALLEL'),
  // Ondertekenaars in volgorde (index = volgorde).
  signers: z.array(signerInputSchema).min(1, 'Voeg minstens één ondertekenaar toe')
})
export type SaveFieldsInput = z.infer<typeof saveFieldsSchema>

export const otpVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Voer de 6-cijferige code in')
})

export const signSubmitSchema = z.object({
  signatureDataUrl: z
    .string()
    .regex(/^data:image\/(png|jpe?g);base64,/, 'Ongeldige handtekening'),
  decline: z.literal(false).optional()
})

export const declineSchema = z.object({
  reason: z.string().trim().max(500).optional().or(z.literal(''))
})

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Verplicht').max(200)
})

export const totpVerifySchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Voer de 6-cijferige code in')
})
