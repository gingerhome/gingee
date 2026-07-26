/**
 * platform.assertSafeAppName + reserved delete protection
 */
const path = require('path');
const { als } = require('../../modules/gingee');
const platform = require('../../modules/platform');

describe('platform assertSafeAppName', () => {
  test('accepts alphanumeric, underscore, hyphen', () => {
    expect(platform.assertSafeAppName('myApp')).toBe('myApp');
    expect(platform.assertSafeAppName('app_1')).toBe('app_1');
    expect(platform.assertSafeAppName('app-name')).toBe('app-name');
    expect(platform.assertSafeAppName('Glade')).toBe('Glade');
  });

  test('rejects empty, whitespace, and padded names', () => {
    expect(() => platform.assertSafeAppName('')).toThrow(/Invalid app name/);
    expect(() => platform.assertSafeAppName('  app')).toThrow(/Invalid app name/);
    expect(() => platform.assertSafeAppName('app  ')).toThrow(/Invalid app name/);
    expect(() => platform.assertSafeAppName(null)).toThrow(/Invalid app name/);
    expect(() => platform.assertSafeAppName(123)).toThrow(/Invalid app name/);
  });

  test('rejects path separators and traversal forms', () => {
    expect(() => platform.assertSafeAppName('../evil')).toThrow(/Invalid app name/);
    expect(() => platform.assertSafeAppName('..')).toThrow(/Invalid app name/);
    expect(() => platform.assertSafeAppName('foo/bar')).toThrow(/Invalid app name/);
    expect(() => platform.assertSafeAppName('foo\\bar')).toThrow(/Invalid app name/);
    expect(() => platform.assertSafeAppName('app name')).toThrow(/Invalid app name/);
    expect(() => platform.assertSafeAppName('app.name')).toThrow(/Invalid app name/);
  });

  test('with webPath context, safe names resolve under web root', async () => {
    const webPath = path.resolve('/project/web');
    await als.run({ webPath, projectRoot: path.resolve('/project') }, async () => {
      expect(platform.assertSafeAppName('demo')).toBe('demo');
    });
  });
});

describe('platform reserved delete', () => {
  test('isReservedForDelete / assertAppDeletable protect glade', () => {
    expect(platform.isReservedForDelete('glade')).toBe(true);
    expect(platform.isReservedForDelete('GLADE')).toBe(true);
    expect(platform.isReservedForDelete('demo')).toBe(false);
    expect(() => platform.assertAppDeletable('glade')).toThrow(/Cannot delete reserved/);
    expect(platform.assertAppDeletable('my_app')).toBe('my_app');
  });

  test('deleteApp refuses glade without allowReserved', async () => {
    const webPath = path.resolve('/project/web');
    const store = {
      webPath,
      projectRoot: path.resolve('/project'),
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
      allApps: {
        glade: {
          name: 'glade',
          appWebPath: path.join(webPath, 'glade'),
          appBoxPath: path.join(webPath, 'glade', 'box'),
          config: {},
          in_maintenance: false
        }
      },
      transpileCache: new Map(),
      staticFileCache: { clear: jest.fn() },
      globalConfig: { privileged_apps: ['glade'] }
    };

    await als.run(store, async () => {
      await expect(platform.deleteApp('glade')).rejects.toThrow(/Cannot delete reserved/);
      await expect(platform.deleteApp('../glade')).rejects.toThrow(/Invalid app name/);
    });
  });

  test('deleteApp refuses names in privileged_apps', async () => {
    const webPath = path.resolve('/project/web');
    const store = {
      webPath,
      projectRoot: path.resolve('/project'),
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
      allApps: {
        opspanel: {
          name: 'opspanel',
          appWebPath: path.join(webPath, 'opspanel'),
          appBoxPath: path.join(webPath, 'opspanel', 'box'),
          config: {},
          in_maintenance: false
        }
      },
      transpileCache: new Map(),
      staticFileCache: { clear: jest.fn() },
      globalConfig: { privileged_apps: ['opspanel'] }
    };

    await als.run(store, async () => {
      expect(platform.isReservedForDelete('opspanel')).toBe(true);
      await expect(platform.deleteApp('opspanel')).rejects.toThrow(/Cannot delete reserved/);
    });
  });

  test('installApp rejects unsafe app names before extract', async () => {
    const webPath = path.resolve('/project/web');
    await als.run(
      {
        webPath,
        projectRoot: path.resolve('/project'),
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
        allApps: {}
      },
      async () => {
        await expect(
          platform.installApp('../evil', Buffer.from('not-a-zip'), [])
        ).rejects.toThrow(/Invalid app name/);
        await expect(
          platform.installApp('evil/name', Buffer.from('not-a-zip'), [])
        ).rejects.toThrow(/Invalid app name/);
      }
    );
  });
});

describe('GladeInstallModalMode.isReservedAppName', () => {
  const { isReservedAppName } = require('../../web/glade/scripts/install_modal_mode.js');

  test('marks glade only', () => {
    expect(isReservedAppName('glade')).toBe(true);
    expect(isReservedAppName('Glade')).toBe(true);
    expect(isReservedAppName('demo')).toBe(false);
  });
});
