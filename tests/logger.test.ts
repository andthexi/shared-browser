import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RuntimeLogger } from '../src/logger.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('runtime logger', () => {
  it('resets, writes, and reads bounded tails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'shared-browser-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'runtime.log');
    const logger = new RuntimeLogger(path);
    await logger.reset();
    logger.write('first');
    logger.write('second');
    expect(logger.readTail(1)).toHaveLength(1);
    expect(logger.readTail(1)[0]).toContain('second');
    expect((await readFile(path, 'utf8')).split('\n').filter(Boolean)).toHaveLength(2);
    await logger.reset();
    expect(logger.readTail()).toEqual([]);
  });
});