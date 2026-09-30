import { createRoot } from 'react-dom/client'
import { App } from './App'
import { WhiteNeutral } from './whiteNeutral'

createRoot(document.getElementById('root')!).render(
  <>
    <WhiteNeutral />
    <App />
  </>,
)
