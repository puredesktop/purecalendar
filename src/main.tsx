import './heldInRoom'
import './compact-in-room.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { CalendarStyles } from './ui/styles'

createRoot(document.getElementById('root')!).render(
  <>
    <CalendarStyles />
    <App />
  </>,
)
