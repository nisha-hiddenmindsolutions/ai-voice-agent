import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// --- 🛡️ ROGUE SERVICE WORKER CLEANUP ---
// Modern browsers cache Service Workers by port (e.g., localhost:5173).
// If a previous project used a worker, it may intercept LiveKit Cloud requests.
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
            registration.unregister();
            console.log('🛡️ [SYSTEM] Unregistered rogue Service Worker:', registration);
        }
    });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
