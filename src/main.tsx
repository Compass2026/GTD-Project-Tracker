import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
// Register the auto-generated service worker from vite-plugin-pwa
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import AuthGate from './AuthGate.tsx';
import './index.css';

registerSW({
  immediate: true,
  onNeedRefresh() {
    console.info('[PWA] New content available, reloading…');
  },
  onOfflineReady() {
    console.info('[PWA] App is ready to work offline.');
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
);
