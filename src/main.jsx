import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/ui/ErrorBoundary.jsx'

// Global error handlers — prevent unhandled exceptions/rejections from silently killing the app
window.addEventListener('error', (event) => {
  console.error('[global] Unhandled error:', event.error || event.message)
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('[global] Unhandled promise rejection:', event.reason)
  event.preventDefault()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
