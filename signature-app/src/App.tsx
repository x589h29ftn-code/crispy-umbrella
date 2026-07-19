import { useAppStore } from './store'
import { LandingPage } from './components/LandingPage'
import { Wizard } from './components/wizard/Wizard'
import { CollectionsPage } from './components/collections/CollectionsPage'
import { ResultsPage } from './components/results/ResultsPage'
import { DrawPage } from './components/DrawPage'

export default function App() {
  const phase = useAppStore((s) => s.phase)
  switch (phase) {
    case 'wizard':
      return <Wizard />
    case 'collections':
      return <CollectionsPage />
    case 'results':
      return <ResultsPage />
    case 'draw':
      return <DrawPage />
    default:
      return <LandingPage />
  }
}
