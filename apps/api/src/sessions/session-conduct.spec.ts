import { GUIDED_CONDUCT, REPEAT_CONDUCT, SOURCE_FIRST_CONDUCT } from './session-conduct';

describe('session conduct scripts', () => {
  it.each([GUIDED_CONDUCT, SOURCE_FIRST_CONDUCT])(
    'supports a bounded objective across sessions',
    (conduct) => {
      expect(conduct).toContain('Agree one objective');
      expect(conduct).toContain('Reading, derivation, discussion, and standalone labs');
      expect(conduct).toContain('across sessions');
      expect(conduct).toContain('stop immediately');
      expect(conduct).toContain('Do not add a completion exam');
      expect(conduct).toContain('zero to two');
      expect(conduct).toContain('Do not silently expand');
      expect(conduct).toContain('do not write my assessed answer');
      expect(conduct).not.toContain('ritual in order');
      expect(conduct).not.toContain('3-7');
    },
  );

  it('SOURCE FIRST forces source reconstruction, teach-back, and doing', () => {
    expect(SOURCE_FIRST_CONDUCT.toLowerCase()).toContain('explain');
    expect(SOURCE_FIRST_CONDUCT.toLowerCase()).toContain('in my own words');
    expect(SOURCE_FIRST_CONDUCT).toContain('applicationEvents');
    expect(SOURCE_FIRST_CONDUCT).toContain('Obsidian');
    expect(SOURCE_FIRST_CONDUCT).toContain(
      'Do not teach the topic before required source reconstruction',
    );
    expect(SOURCE_FIRST_CONDUCT).toContain('Do not list the topic in studiedTopics');
    expect(SOURCE_FIRST_CONDUCT).toContain('Pause while I leave the chat');
    expect(SOURCE_FIRST_CONDUCT.indexOf('1. SELECT')).toBeLessThan(
      SOURCE_FIRST_CONDUCT.indexOf('2. CONSUME'),
    );
    expect(SOURCE_FIRST_CONDUCT.indexOf('2. CONSUME')).toBeLessThan(
      SOURCE_FIRST_CONDUCT.indexOf('3. RECONSTRUCT'),
    );
    expect(SOURCE_FIRST_CONDUCT.indexOf('3. RECONSTRUCT')).toBeLessThan(
      SOURCE_FIRST_CONDUCT.indexOf('4. CLOSED-SOURCE TEACH-BACK'),
    );
    expect(SOURCE_FIRST_CONDUCT).toContain('already credited');
    expect(GUIDED_CONDUCT).toContain('Curated sources are references, not a gate');
  });

  it('SOURCE FIRST stops a blocked legacy first-exposure session', () => {
    expect(SOURCE_FIRST_CONDUCT).toContain('LEGACY FIRST EXPOSURE BLOCKED');
    expect(SOURCE_FIRST_CONDUCT).toContain('STOP');
  });

  it('REPEAT keeps self-grading and forces elaboration on misses', () => {
    expect(REPEAT_CONDUCT).toContain('grade my own recall');
    expect(REPEAT_CONDUCT.toLowerCase()).toContain('again');
    expect(REPEAT_CONDUCT.toLowerCase()).toContain('explain');
  });
});
