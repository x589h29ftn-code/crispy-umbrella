// Entrypunt: startmenu tonen, daarna de game opstarten met de gekozen seed.
// De echte gamemodules volgen in latere stappen; dit is de scaffold-versie.

const playButton = document.getElementById('play') as HTMLButtonElement
const seedInput = document.getElementById('seed') as HTMLInputElement

playButton.addEventListener('click', () => {
  const seed = seedInput.value.trim() || `wereld-${Math.floor(Math.random() * 100000)}`
  console.log('Start game met seed:', seed)
})

export {}
