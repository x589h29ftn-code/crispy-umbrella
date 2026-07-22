import { z } from 'zod'

const email = z.string().email('Ongeldig e-mailadres').max(200)
const naam = z.string().trim().min(1, 'Verplicht').max(200)

export const clientSchema = z.object({
  displayName: naam,
  companyName: z.string().trim().max(200).optional().or(z.literal('')),
  contactName: z.string().trim().max(200).optional().or(z.literal('')),
  email: z.string().email().max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(60).optional().or(z.literal('')),
  kvk: z.string().trim().max(20).optional().or(z.literal('')),
  address: z.string().trim().max(200).optional().or(z.literal('')),
  postalCode: z.string().trim().max(16).optional().or(z.literal('')),
  city: z.string().trim().max(120).optional().or(z.literal('')),
  country: z.string().trim().max(80).optional().or(z.literal('')),
  notes: z.string().trim().max(2000).optional().or(z.literal(''))
})
export type ClientInput = z.infer<typeof clientSchema>

export const dossierCreateSchema = z.object({
  title: naam,
  message: z.string().trim().max(2000).optional().or(z.literal(''))
})

export const placementSchema = z.object({
  page: z.number().int().min(0),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive()
})

export const recipientInputSchema = z.object({
  name: naam,
  email,
  clientId: z.string().cuid().optional().nullable(),
  role: z.enum(['ZELF', 'EXTERN']).default('EXTERN'),
  // Elke ontvanger heeft één of meer tekenvakken.
  fields: z.array(placementSchema).min(1, 'Plaats minstens één tekenveld voor deze ontvanger')
})

export const saveFieldsSchema = z.object({
  // Eigen handtekeningvakken van de accountant (worden direct gestempeld).
  selfFields: z.array(placementSchema).default([]),
  recipients: z.array(recipientInputSchema).default([])
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
