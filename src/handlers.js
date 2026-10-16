// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the tests, so
// the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS, SCENE_ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // Discovery: the alarm, shutters and lights of the panel.
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated(() => app.deviceChanged());
  gladys.onDeviceUpdated(() => app.deviceChanged());

  // Alarm mode, zones, shutters, lights.
  gladys.onSetValue((device, feature, value) => app.setValue(device, feature, value));

  // Configuration screen buttons.
  gladys.onAction(ACTIONS.TEST_CONNECTION, () => app.testConnection());
  gladys.onAction(ACTIONS.IMPORT_CARD, (fields) => app.importCard(fields));
  gladys.onAction(ACTIONS.REFRESH, () => app.refresh());
  gladys.onAction(ACTIONS.RESET_FAULTS, (fields) => app.resetFaults(fields));

  // Scene action.
  gladys.onSceneAction(SCENE_ACTIONS.RESET_FAULTS, async (fields) => {
    await app.resetFaults(fields);
    return undefined;
  });

  // Configuration changed by the user.
  gladys.onConfigUpdated((config) => app.configUpdated(config));

  // Connection lifecycle: the first connection starts, a reconnection resends.
  gladys.on('connected', async () => {
    try {
      await app.connected(await gladys.getConfig());
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
}
