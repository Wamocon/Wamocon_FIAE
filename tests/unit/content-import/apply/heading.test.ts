// splitEnablerHeading is exported for the upload: it reads the code and the
// title from the first line of an enabler text.
import { splitEnablerHeading } from '@/lib/content-import/apply/plan';

describe('splitEnablerHeading', () => {
  it('reads the code and the title of the heading forms of the sources', () => {
    expect(splitEnablerHeading('4a) Netzwerkgeräte')).toEqual({
      code: '4a',
      title: 'Netzwerkgeräte',
    });
    expect(splitEnablerHeading('  6.2d) Titel mit Zusatz ')).toEqual({
      code: '6.2d',
      title: 'Titel mit Zusatz',
    });
    expect(splitEnablerHeading('Szenario 1b) Der Router')).toEqual({
      code: '1b',
      title: 'Der Router',
    });
    expect(splitEnablerHeading('Quiz 24/1a: Titel')).toEqual({
      code: '24.1a',
      title: 'Titel',
    });
  });

  it('gives no code for a line without one', () => {
    expect(splitEnablerHeading('  Nur ein Titel ')).toEqual({
      code: null,
      title: 'Nur ein Titel',
    });
    expect(splitEnablerHeading('')).toEqual({ code: null, title: '' });
  });
});
