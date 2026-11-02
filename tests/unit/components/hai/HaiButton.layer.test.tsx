import { render } from '@testing-library/react';
import { HaiButton } from '@/components/hai/HaiButton';
import { FlipbookViewer } from '@/components/ui/FlipbookViewer';
import { LanguageProvider } from '@/contexts/LanguageContext';

// WMCNL-2969: the round HAI button lay over the open PDF viewer and over dialogs.
// Both used z-50 and the button comes later in the page, so it was drawn on top. The
// button is one level lower now, so a viewer or a dialog (z-50) lies over it.

jest.mock('@/components/hai/HaiProvider', () => ({
  __esModule: true,
  useHai: () => ({
    viewMode: 'hidden',
    toggleChat: jest.fn(),
    messages: [],
    setViewMode: jest.fn(),
  }),
}));
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => <span data-testid="shark" data-src={props.src} />,
}));
jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () => () => null,
}));

const layerOf = (element: Element | null): number => {
  const match = /(?:^|\s)z-(\d+)(?:\s|$)/.exec(element?.className ?? '');
  return match ? Number(match[1]) : -1;
};

describe('HaiButton layer', () => {
  it('lies under the viewer of a document and under dialogs', () => {
    const { container: buttonView } = render(
      <LanguageProvider>
        <HaiButton />
      </LanguageProvider>
    );
    const button = buttonView.querySelector('[data-tour="hai-button"]');
    expect(button).not.toBeNull();
    const buttonLayer = layerOf(button);

    const { container: viewerView } = render(
      <LanguageProvider>
        <FlipbookViewer
          pdfUrl="/x.pdf"
          title="Lehrtext"
          isOpen
          onClose={() => undefined}
        />
      </LanguageProvider>
    );
    const overlay = viewerView.querySelector('.fixed.inset-0');
    expect(overlay).not.toBeNull();

    expect(buttonLayer).toBeGreaterThan(0);
    expect(layerOf(overlay)).toBeGreaterThan(buttonLayer);
  });

  it('is still above the normal page content', () => {
    const { container } = render(
      <LanguageProvider>
        <HaiButton />
      </LanguageProvider>
    );
    expect(
      layerOf(container.querySelector('[data-tour="hai-button"]'))
    ).toBeGreaterThanOrEqual(40);
  });
});
