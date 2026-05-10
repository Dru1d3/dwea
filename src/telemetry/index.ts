/**
 * Public surface of the telemetry module.
 *
 * Two consumers:
 *   - [App.tsx](../App.tsx) → wires emitter into the chat path.
 *   - [SettingsDialog](../ui/SettingsDialog.tsx) → exposes the in-app CSV
 *     export button (downloads the buffer for hand-off to DWEA-98).
 */
export type { TelemetryEmitter, TurnHandle, BeginTurnArgs } from './emitter.js';
export type { TelemetryRecord, TurnContext } from './types.js';
export type { TelemetryBackend, TelemetryStore } from './store.js';
export type { SendTelemetry } from './transport.js';
export type { SessionContext } from './session.js';
export { createTelemetry } from './emitter.js';
export { createMemoryBackend, createBrowserBackend, withRecentMirror } from './store.js';
export { createHttpTransport, resolveEndpointFromEnv } from './transport.js';
export { createSessionContext, deviceTier, resetSessionForTests } from './session.js';
export { recordsToCsv, TELEMETRY_CSV_COLUMNS } from './csv.js';
