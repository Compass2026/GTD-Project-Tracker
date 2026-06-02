import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
// Register the auto-generated service worker from vite-plugin-pwa
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Register SW with auto-update. The callback fires when a new SW is ready.
registerSW({
  immediate: true,
  onNeedRefresh() {
    // A new version of the app is available; auto-reload for simplicity.
    // You could show a "New version available — Refresh" toast here instead.
    console.info('[PWA] New content available, reloading…');
  },
  onOfflineReady() {
    console.info('[PWA] App is ready to work offline.');
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
