// Entrypoint voor de achtergrondwerker (aparte container, zie docker-compose.yml).
// Draai met:  npm run worker
import { runForever } from '@/lib/jobs/worker'

runForever().catch((e) => {
  console.error('[worker] onherstelbare fout', e)
  process.exit(1)
})
