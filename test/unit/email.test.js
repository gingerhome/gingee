const { als } = require('../../modules/gingee');

const mockSendgridSend = jest.fn();
const mockSendgridShutdown = jest.fn();
const mockConsoleSend = jest.fn();

jest.mock('../../modules/email_providers/sendgrid', () => {
  return jest.fn().mockImplementation(function SendGridMock(config, app, logger) {
    this.config = config;
    this.app = app;
    this.logger = logger;
    this.send = mockSendgridSend;
    this.shutdown = mockSendgridShutdown;
  });
});

jest.mock('../../modules/email_providers/console', () => {
  return jest.fn().mockImplementation(function ConsoleMock(config, app, logger) {
    this.config = config;
    this.app = app;
    this.logger = logger;
    this.send = mockConsoleSend;
    this.shutdown = jest.fn();
  });
});

const SendGridAdapter = require('../../modules/email_providers/sendgrid');
const ConsoleAdapter = require('../../modules/email_providers/console');
const email = require('../../modules/email');

describe('email.js - single config + sendWithConfig', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    email._resetForTests();

    mockConsoleSend.mockResolvedValue({
      messageId: 'console-1',
      provider: 'console',
      status: 'logged'
    });
    mockSendgridSend.mockResolvedValue({
      messageId: 'sg-msg-1',
      provider: 'sendgrid',
      status: 'sent'
    });
  });

  test('merge order: server < app < runtime', () => {
    const merged = email._mergeEmailConfig(
      { type: 'console', from: 'server@x.com' },
      { type: 'sendgrid', api_key: 'SG.app' },
      { from: 'runtime@x.com' }
    );
    expect(merged).toEqual({
      type: 'sendgrid',
      from: 'runtime@x.com',
      api_key: 'SG.app'
    });
  });

  test('send uses console adapter from app config (overrides server sendgrid type)', async () => {
    email.initServer({ type: 'sendgrid', api_key: 'SG.server' }, logger);
    const app = {
      name: 'demo',
      config: {
        email: { type: 'console', from: 'app@demo.test', from_name: 'Demo' }
      }
    };
    email.initApp(app, logger);
    expect(ConsoleAdapter).toHaveBeenCalled();
    expect(SendGridAdapter).not.toHaveBeenCalled();

    await als.run({ appName: 'demo', app, logger }, async () => {
      const result = await email.send({
        to: 'user@example.com',
        subject: 'Hello',
        text: 'Hi there'
      });
      expect(result.provider).toBe('console');
      expect(mockConsoleSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: 'Hello',
          text: 'Hi there'
        })
      );
      expect(mockSendgridSend).not.toHaveBeenCalled();
    });
  });

  test('send throws when no email type is configured', async () => {
    email.initServer(null, logger);
    const app = { name: 'empty', config: {} };
    email.initApp(app, logger);

    await als.run({ appName: 'empty', app, logger }, async () => {
      await expect(
        email.send({ to: 'a@b.com', subject: 'x', text: 'y' })
      ).rejects.toThrow(/No email configuration/);
    });
  });

  test('sendWithConfig overrides app/server for one transaction only', async () => {
    email.initServer({ type: 'console', from: 'server@x.com' }, logger);
    const app = {
      name: 'demo',
      config: { email: { type: 'console', from: 'app@demo.test' } }
    };
    email.initApp(app, logger);
    jest.clearAllMocks();
    mockConsoleSend.mockResolvedValue({
      messageId: 'console-1',
      provider: 'console',
      status: 'logged'
    });
    mockSendgridSend.mockResolvedValue({
      messageId: 'sg-msg-1',
      provider: 'sendgrid',
      status: 'sent'
    });

    await als.run({ appName: 'demo', app, logger }, async () => {
      const result = await email.sendWithConfig(
        {
          type: 'sendgrid',
          api_key: 'SG.runtime',
          from: 'billing@demo.test'
        },
        {
          to: 'customer@example.com',
          subject: 'Invoice',
          html: '<p>Pay up</p>'
        }
      );

      expect(result.provider).toBe('sendgrid');
      expect(result.status).toBe('sent');
      expect(SendGridAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sendgrid',
          api_key: 'SG.runtime',
          from: 'billing@demo.test'
        }),
        app,
        logger
      );
      expect(mockSendgridSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'customer@example.com',
          subject: 'Invoice',
          html: '<p>Pay up</p>'
        })
      );
      expect(mockSendgridShutdown).toHaveBeenCalled();

      // Default path still console — runtime override must not stick
      const again = await email.send({
        to: 'user@example.com',
        subject: 'Still console',
        text: 'ok'
      });
      expect(again.provider).toBe('console');
      expect(mockConsoleSend).toHaveBeenCalled();
    });
  });

  test('sendWithConfig can work when app has no default email config', async () => {
    email.initServer({}, logger);
    const app = { name: 'bare', config: {} };
    email.initApp(app, logger);

    await als.run({ appName: 'bare', app, logger }, async () => {
      const result = await email.sendWithConfig(
        { type: 'console', from: 'tmp@x.com' },
        { to: 'a@b.com', subject: 'One-off', text: 'body' }
      );
      expect(result.provider).toBe('console');
      expect(ConsoleAdapter).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'console', from: 'tmp@x.com' }),
        app,
        logger
      );
    });
  });

  test('send validates required message fields', async () => {
    const app = {
      name: 'demo',
      config: { email: { type: 'console', from: 'a@b.com' } }
    };
    email.initApp(app, logger);

    await als.run({ appName: 'demo', app, logger }, async () => {
      await expect(email.send({})).rejects.toThrow(/to/);
      await expect(email.send({ to: 'a@b.com' })).rejects.toThrow(/subject/);
      await expect(email.send({ to: 'a@b.com', subject: 'S' })).rejects.toThrow(/text/);
    });
  });

  test('shutdownApp and reinitApp swap provider cleanly', async () => {
    const app = {
      name: 'demo',
      config: { email: { type: 'console', from: 'a@b.com' } }
    };
    email.initApp(app, logger);
    await email.shutdownApp('demo', logger);

    app.config.email = { type: 'sendgrid', api_key: 'SG.x', from: 'a@b.com' };
    await email.reinitApp('demo', app, logger);
    expect(SendGridAdapter).toHaveBeenCalled();

    await als.run({ appName: 'demo', app, logger }, async () => {
      const result = await email.send({
        to: 'u@e.com',
        subject: 'Hi',
        text: 'body'
      });
      expect(result.provider).toBe('sendgrid');
      expect(mockSendgridSend).toHaveBeenCalled();
    });
  });
});
