import { LEARN_CONDUCT, REPEAT_CONDUCT } from './session-conduct';

describe('session conduct scripts', () => {
  it('LEARN forces teach-back and doing', () => {
    expect(LEARN_CONDUCT.toLowerCase()).toContain('explain');
    expect(LEARN_CONDUCT.toLowerCase()).toContain('in my own words');
    expect(LEARN_CONDUCT).toContain('applicationEvents');
    expect(LEARN_CONDUCT).toContain('Obsidian');
    expect(LEARN_CONDUCT).toContain('Do not teach the topic before required source reconstruction');
    expect(LEARN_CONDUCT).toContain('do not edit files, execute the task, or write my answer');
    expect(LEARN_CONDUCT).toContain('Do not list the topic in studiedTopics');
    expect(LEARN_CONDUCT).toContain('Pause while I leave the chat');
    expect(LEARN_CONDUCT.indexOf('1. SELECT')).toBeLessThan(LEARN_CONDUCT.indexOf('2. CONSUME'));
    expect(LEARN_CONDUCT.indexOf('2. CONSUME')).toBeLessThan(
      LEARN_CONDUCT.indexOf('3. RECONSTRUCT'),
    );
    expect(LEARN_CONDUCT.indexOf('3. RECONSTRUCT')).toBeLessThan(
      LEARN_CONDUCT.indexOf('5. CLOSED-SOURCE TEACH-BACK'),
    );
    expect(LEARN_CONDUCT.indexOf('5. CLOSED-SOURCE TEACH-BACK')).toBeLessThan(
      LEARN_CONDUCT.indexOf('7. DO'),
    );
  });

  it('REPEAT keeps self-grading and forces elaboration on misses', () => {
    expect(REPEAT_CONDUCT).toContain('grade my own recall');
    expect(REPEAT_CONDUCT.toLowerCase()).toContain('again');
    expect(REPEAT_CONDUCT.toLowerCase()).toContain('explain');
  });
});
