import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

describe('SettingsController', () => {
  it("returns the caller's settings row", async () => {
    const get = jest.fn().mockResolvedValue({
      userId: 'userA',
      obsidianVault: '/vault',
      timezone: 'UTC',
      digestHour: 9,
      nudgeHour: 20,
      telegramLinked: false,
    });
    const settings = { get } as any as SettingsService;
    const ctrl = new SettingsController(settings);

    const result = await ctrl.get('userA');

    expect(get).toHaveBeenCalledWith('userA');
    expect(result).toEqual({
      userId: 'userA',
      obsidianVault: '/vault',
      timezone: 'UTC',
      digestHour: 9,
      nudgeHour: 20,
      telegramLinked: false,
    });
  });

  it('returns a default row scoped to the caller when none exists', async () => {
    const get = jest.fn().mockResolvedValue({
      userId: 'userB',
      obsidianVault: null,
      timezone: 'UTC',
      digestHour: 9,
      nudgeHour: 20,
      telegramLinked: false,
    });
    const settings = { get } as any as SettingsService;
    const ctrl = new SettingsController(settings);

    const result = await ctrl.get('userB');

    expect(get).toHaveBeenCalledWith('userB');
    expect(result).toEqual({
      userId: 'userB',
      obsidianVault: null,
      timezone: 'UTC',
      digestHour: 9,
      nudgeHour: 20,
      telegramLinked: false,
    });
  });
});
