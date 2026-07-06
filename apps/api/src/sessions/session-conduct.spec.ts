import { LEARN_CONDUCT, REPEAT_CONDUCT } from './session-conduct';

describe('session conduct scripts', () => {
  it('LEARN forces teach-back and doing', () => {
    expect(LEARN_CONDUCT.toLowerCase()).toContain('explain');
    expect(LEARN_CONDUCT.toLowerCase()).toContain('in my own words');
    expect(LEARN_CONDUCT).toContain('applicationEvents');
    expect(LEARN_CONDUCT).toContain('Obsidian');
  });

  it('REPEAT keeps self-grading and forces elaboration on misses', () => {
    expect(REPEAT_CONDUCT).toContain('grade my own recall');
    expect(REPEAT_CONDUCT.toLowerCase()).toContain('again');
    expect(REPEAT_CONDUCT.toLowerCase()).toContain('explain');
  });
});
