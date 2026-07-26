import { GUIDED_CONDUCT, REPEAT_CONDUCT, SOURCE_FIRST_CONDUCT } from './session-conduct';

describe('session conduct scripts', () => {
  it('GUIDED follows the approved teach-probe-do ritual without writing the answer', () => {
    expect(GUIDED_CONDUCT).toContain('1. Calibrate');
    expect(GUIDED_CONDUCT).toContain('2. Explain incrementally');
    expect(GUIDED_CONDUCT).toContain('5. Do');
    expect(GUIDED_CONDUCT).toContain('must not write my answer');
  });

  it('SOURCE FIRST forces source reconstruction, teach-back, and doing', () => {
    expect(SOURCE_FIRST_CONDUCT.toLowerCase()).toContain('explain');
    expect(SOURCE_FIRST_CONDUCT.toLowerCase()).toContain('in my own words');
    expect(SOURCE_FIRST_CONDUCT).toContain('applicationEvents');
    expect(SOURCE_FIRST_CONDUCT).toContain('Obsidian');
    expect(SOURCE_FIRST_CONDUCT).toContain(
      'Do not teach the topic before required source reconstruction',
    );
    expect(SOURCE_FIRST_CONDUCT).toContain(
      'do not edit files, execute the task, or write my answer',
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
      SOURCE_FIRST_CONDUCT.indexOf('5. CLOSED-SOURCE TEACH-BACK'),
    );
    expect(SOURCE_FIRST_CONDUCT.indexOf('5. CLOSED-SOURCE TEACH-BACK')).toBeLessThan(
      SOURCE_FIRST_CONDUCT.indexOf('7. DO'),
    );
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
