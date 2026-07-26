import { BadRequestException } from '@nestjs/common';
import { LearningContextService } from './learning-context.service';
import { LearningController } from './learning.controller';

describe('LearningController', () => {
  const result = { schemaVersion: 1 };
  let context: jest.Mock;
  let controller: LearningController;
  let response: { setHeader: jest.Mock };

  beforeEach(() => {
    context = jest.fn().mockResolvedValue(result);
    controller = new LearningController({ context } as any as LearningContextService);
    response = { setHeader: jest.fn() };
  });

  it('delegates the trimmed topic for the current user and disables caching', async () => {
    await expect(controller.context('user-a', '  Hashing  ', response as any)).resolves.toBe(
      result,
    );

    expect(context).toHaveBeenCalledWith('user-a', { topic: 'Hashing' });
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('allows an omitted topic for default selection', async () => {
    await controller.context('user-a', undefined, response as any);

    expect(context).toHaveBeenCalledWith('user-a', { topic: undefined });
  });

  it.each(['', '   ', 'x'.repeat(301)])('rejects invalid supplied topic %p', async (topic) => {
    await expect(controller.context('user-a', topic, response as any)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(context).not.toHaveBeenCalled();
  });

  it('rejects repeated topic query parameters', async () => {
    await expect(
      controller.context('user-a', ['hashing', 'arrays'], response as any),
    ).rejects.toThrow('topic must contain 1 to 300 characters');
    expect(context).not.toHaveBeenCalled();
  });
});
