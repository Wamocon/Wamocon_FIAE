import { componentHoursLabel } from '@/lib/ausbildung/planned-hours';

describe('componentHoursLabel', () => {
  it('shows the code and the hours when the component has hours', () => {
    expect(componentHoursLabel('K1', 440, 'Std gesamt')).toBe(
      'K1 \u2022 440 Std gesamt'
    );
    expect(componentHoursLabel('\u00a74.2.1', 480, 'Std gesamt')).toBe(
      '\u00a74.2.1 \u2022 480 Std gesamt'
    );
    expect(componentHoursLabel('K10', '880', 'Std gesamt')).toBe(
      'K10 \u2022 880 Std gesamt'
    );
  });

  it('shows the code alone when the hours are 0, empty or unknown', () => {
    for (const hours of [0, null, undefined, '', 'x', Number.NaN, -5]) {
      expect(
        componentHoursLabel('K20', hours as number | null, 'Std gesamt')
      ).toBe('K20');
    }
  });

  it('never says "0 Std gesamt"', () => {
    expect(componentHoursLabel('K21', 0, 'Std gesamt')).not.toMatch(/0 Std/);
  });
});
