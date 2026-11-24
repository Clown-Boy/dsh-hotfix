import { createRoot } from 'react-dom/client'
import { setupAndroidWebHooks } from './android/bridge.js'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

setupAndroidWebHooks()
ensureKatex()
setupTheme()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
