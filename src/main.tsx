import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { LipsyncTestPage } from './lipsync/TestPage.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root mount node');
}

// Spike B ([DWEA-118](/DWEA/issues/DWEA-118)) opt-in: `?lipsync-test` swaps
// in the telemetry harness page instead of the splat scene. The query-param
// gate keeps the production landing untouched.
const isLipsyncTest =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('lipsync-test');

createRoot(container).render(
  <StrictMode>{isLipsyncTest ? <LipsyncTestPage /> : <App />}</StrictMode>,
);
