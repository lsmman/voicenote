test.each(['web', 'ios', 'android'])('catalog reports %s download sizes independently', (platform) => {
  jest.isolateModules(() => {
    const { Platform } = require('react-native');
    const original = Platform.OS;
    Platform.OS = platform;
    try {
      const { getModel, listModels } = require('../models') as typeof import('../models');
      const model = getModel('large-v3-turbo-q5_0');
      expect(model.sizeBytes).toBe(platform === 'web' ? model.web.sizeBytes : model.native.sizeBytes);
      expect(model.web.sizeBytes).not.toBe(model.native.sizeBytes);
      expect(model.native.sizeBytes).toBe(574_000_000);
      expect(listModels()[0].sizeBytes).toBe(model.sizeBytes);
    } finally {
      Platform.OS = original;
    }
  });
});
