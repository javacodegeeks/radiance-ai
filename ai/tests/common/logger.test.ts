import { runWithRequestId } from '../../src/common/requestContext';

// installRequestIdLogging() patches console methods once, globally, so each
// test imports it fresh via jest.resetModules() to get an uninstalled module
// and always restores the real console methods afterwards.
describe('installRequestIdLogging', () => {
  const originalLog = console.log;

  afterEach(() => {
    console.log = originalLog;
    jest.resetModules();
  });

  it('prefixes log lines with the active request ID', () => {
    const { installRequestIdLogging } = require('../../src/common/logger');
    const spy = jest.fn();
    console.log = spy;

    installRequestIdLogging();
    runWithRequestId('req-abc', () => {
      console.log('hello');
    });

    expect(spy).toHaveBeenCalledWith('[req=req-abc]', 'hello');
  });

  it('logs without a prefix when there is no active request ID', () => {
    const { installRequestIdLogging } = require('../../src/common/logger');
    const spy = jest.fn();
    console.log = spy;

    installRequestIdLogging();
    console.log('no request context');

    expect(spy).toHaveBeenCalledWith('no request context');
  });

  it('only installs the patch once even if called multiple times', () => {
    const { installRequestIdLogging } = require('../../src/common/logger');
    installRequestIdLogging();
    const patchedLog = console.log;

    installRequestIdLogging();

    expect(console.log).toBe(patchedLog);
  });
});
