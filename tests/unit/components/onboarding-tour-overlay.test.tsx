import { fireEvent, render, screen } from '@testing-library/react';
import { TourOverlay } from '@/components/onboarding/TourOverlay';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useSidebar } from '@/contexts/SidebarContext';

jest.mock('@/contexts/OnboardingContext');
jest.mock('@/contexts/SidebarContext');
jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key: string) =>
      ({
        'onboarding.next': 'Weiter',
        'onboarding.back': 'Zurück',
        'onboarding.skip': 'Überspringen',
        'onboarding.finish': 'Fertig',
      })[key] ?? key,
  }),
}));

// WMCNL-2972 / WMCNL-3035: some steps of the tour could not be continued with
// "Weiter". The card is always placed inside the window, also without a target,
// and Enter on a focused button advances once, not twice.

const step = (id: string, selector: string) => ({
  id,
  targetSelector: selector,
  titleKey: `title.${id}`,
  descriptionKey: `desc.${id}`,
  placement: 'right' as const,
});

function setup(selector: string) {
  const nextStep = jest.fn();
  const steps = [step('a', selector), step('b', '[data-tour="x"]')];
  (useOnboarding as jest.Mock).mockReturnValue({
    isActive: true,
    currentStep: steps[0],
    currentStepIndex: 0,
    steps,
    nextStep,
    prevStep: jest.fn(),
    skipTour: jest.fn(),
  });
  (useSidebar as jest.Mock).mockReturnValue({
    isOpen: true,
    open: jest.fn(),
    close: jest.fn(),
  });
  render(<TourOverlay />);
  return { nextStep };
}

describe('TourOverlay', () => {
  beforeAll(() => {
    (global as any).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'innerWidth', {
      value: 1280,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 720,
      configurable: true,
    });
  });

  it('places the card inside the window when the target is not on the page, and Weiter works', async () => {
    const { nextStep } = setup('[data-tour="missing"]');
    const card = (await screen.findByText('title.a')).closest(
      'div.absolute'
    ) as HTMLElement;
    // wait for the placement (the effect runs without delay for a header step)
    await new Promise(resolve => setTimeout(resolve, 80));
    const top = parseFloat(card.style.top);
    const left = parseFloat(card.style.left);
    expect(top).toBeGreaterThanOrEqual(16);
    expect(left).toBeGreaterThanOrEqual(16);
    expect(left + 320).toBeLessThanOrEqual(1280);
    expect(card.className).toContain('overflow-y-auto');
    fireEvent.click(screen.getByRole('button', { name: /Weiter/ }));
    expect(nextStep).toHaveBeenCalledTimes(1);
  });

  it('advances once when Enter is pressed on the focused button', () => {
    const { nextStep } = setup('[data-tour="missing"]');
    const button = screen.getByRole('button', { name: /Weiter/ });
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(nextStep).not.toHaveBeenCalled();
    // the click of the browser (not simulated by keyDown) does the one step
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(nextStep).toHaveBeenCalledTimes(1);
  });
});
