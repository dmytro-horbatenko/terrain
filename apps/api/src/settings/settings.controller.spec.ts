import { SettingsController } from './settings.controller';

describe('SettingsController', () => {
  it("returns the caller's settings row", async () => {
    const findUnique = jest.fn().mockResolvedValue({
      userId: 'userA',
      obsidianVault: '/vault',
      telegramChatId: null,
    });
    const ctrl = new SettingsController({ settings: { findUnique } } as any);

    const result = await ctrl.get('userA');

    expect(findUnique).toHaveBeenCalledWith({ where: { userId: 'userA' } });
    expect(result).toEqual({ userId: 'userA', obsidianVault: '/vault', telegramChatId: null });
  });

  it('returns a default row scoped to the caller when none exists', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const ctrl = new SettingsController({ settings: { findUnique } } as any);

    const result = await ctrl.get('userB');

    expect(findUnique).toHaveBeenCalledWith({ where: { userId: 'userB' } });
    expect(result).toEqual({ userId: 'userB', obsidianVault: null, telegramChatId: null });
  });
});
