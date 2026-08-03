import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/auth/password'

// Seedt een eerste beheerder en enkele voorbeeldcliënten. Draai met: npm run db:seed
const prisma = new PrismaClient()

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'beheerder@ottovisseraccountants.nl').toLowerCase()
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Wijzig-Dit-Wachtwoord-1'
  const name = process.env.SEED_ADMIN_NAME ?? 'Beheerder'

  const passwordHash = await hashPassword(password)
  const admin = await prisma.accountant.upsert({
    where: { email },
    update: {},
    create: { email, name, passwordHash, role: 'BEHEERDER' }
  })
  console.log(`Beheerder klaar: ${admin.email}`)

  const count = await prisma.client.count()
  if (count === 0) {
    await prisma.client.createMany({
      data: [
        {
          displayName: 'Bakkerij De Korenbloem B.V.',
          companyName: 'Bakkerij De Korenbloem B.V.',
          contactName: 'J. Jansen',
          email: 'j.jansen@voorbeeld.nl',
          phone: '020-1234567',
          city: 'Amsterdam'
        },
        {
          displayName: 'Timmerbedrijf Van Dijk',
          companyName: 'Timmerbedrijf Van Dijk',
          contactName: 'P. van Dijk',
          email: 'info@vandijk-voorbeeld.nl',
          city: 'Utrecht'
        }
      ]
    })
    console.log('Voorbeeldcliënten toegevoegd.')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
