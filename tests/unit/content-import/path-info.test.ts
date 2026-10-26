// Path derivation of the KfBM source tree. All paths are invented but follow the
// style of the real ones (umlauts, blanks, brackets, split components).
import {
  globalQuizComponentKey,
  pathInfo,
} from '@/lib/content-import/path-info';

const T1 =
  'Komponente Teil 1 (1-15 Monate)\\01 - Informationsmanagement anwenden (§ 4 Abs. 2 Nr. 1)';
const T2_12 =
  'Komponente Teil 2 (16-36 Monate)\\12 - kaufmännische Abläufe gestalten (§ 4 Abs. 3 Nr. 3)';
const T2_62 =
  'Komponente Teil 2 (16-36 Monate)\\06.2 - Auftragsbearbeitung durchführen (§ 4 Abs. 2 Nr. 6)';
const ALL_20 =
  'Komponente - während der gesamten Ausbildung\\20 - Organisation des Betriebes (§ 4 Abs. 4 Nr. 1)';

describe('pathInfo: enabler tree', () => {
  it('reads component, group, enabler and quiz level from a normal path', () => {
    const info = pathInfo(
      `${T1}\\Enablers\\1a_Beispiel Thema\\Quiz\\1a_Quiz_Medium.docx`
    );
    expect(info.type).toBe('quiz');
    expect(info.difficulty).toBe('medium');
    expect(info.group).toBe('teil1');
    expect(info.folderGroup).toBe('teil1');
    expect(info.component).toMatchObject({
      number: 1,
      split: null,
      key: '01',
      code: 'K1',
      title: 'Informationsmanagement anwenden',
      paragraph: '§ 4 Abs. 2 Nr. 1',
      elective: false,
      excluded: false,
    });
    expect(info.enablerLetter).toBe('a');
    expect(info.enablerKey).toBe('1a');
    expect(info.enablerCode).toBe('K1-a');
    expect(info.key).toBe('quiz:1a:medium');
    expect(info.issues).toEqual([]);
  });

  it('accepts forward slashes, absolute prefixes and the Komponente anchor', () => {
    const rel = `${T1}\\Enablers\\1a_Beispiel\\1a.docx`.replace(/\\/g, '/');
    const abs = `C:/Users/x/OneDrive - Firma/06-01-25 WMC-KfBM/Komponente/${rel}`;
    expect(pathInfo(abs)).toEqual(pathInfo(rel));
    expect(pathInfo(abs).type).toBe('enabler');
    expect(pathInfo(abs).key).toBe('enabler:1a');
  });

  it('handles the "20b) ..." style folder with brackets and long names', () => {
    const info = pathInfo(
      `${ALL_20}\\Enablers\\20b) Rechte und Pflichten aus dem Vertrag sowie Dau- er und Beendigung\\20b).docx`
    );
    expect(info.group).toBe('ganze');
    expect(info.type).toBe('enabler');
    expect(info.enablerKey).toBe('20b');
    expect(info.enablerCode).toBe('K20-b');
    expect(info.issues).toEqual([]);
  });

  it('takes the split from the component folder for 06.2 and the file letter', () => {
    const info = pathInfo(
      `${T2_62}\\Enablers\\6d_Auftrag festlegen\\Quiz\\6d_Quiz_Low.docx`
    );
    expect(info.component?.key).toBe('06.2');
    expect(info.component?.code).toBe('K6.2');
    expect(info.enablerKey).toBe('6.2d');
    expect(info.enablerCode).toBe('K6.2-d');
    expect(info.key).toBe('quiz:6.2d:low');
    expect(info.group).toBe('teil2');
  });

  it('reads the split form 24_1a and the name 25d) of a split component', () => {
    const a = pathInfo(
      'Komponente Teil 1 (1-15 Monate)\\24.1 - Arbeitsorganisation (§ 4 Abs. 4 Nr. 5)\\Enablers\\24_1a_eigene Arbeit planen\\Quiz\\24_1a_Quiz_High.docx'
    );
    expect(a.enablerKey).toBe('24.1a');
    expect(a.issues).toEqual([]);
    const b = pathInfo(
      'Komponente Teil 2 (16-36 Monate)\\25.2 - Zusammenarbeit (§ 4 Abs. 4 Nr. 6)\\Enablers\\25d) Gesprächsführung anwenden\\25_2d.docx'
    );
    expect(b.enablerKey).toBe('25.2d');
    expect(b.type).toBe('enabler');
    expect(b.issues).toEqual([]);
  });

  it('marks K10 to K19 as elective and K18 as excluded', () => {
    const wahl = pathInfo(
      `${T2_12}\\Enablers\\12b) Kassenbuch führen\\12b.docx`
    );
    expect(wahl.group).toBe('wahl');
    expect(wahl.folderGroup).toBe('teil2');
    expect(wahl.component?.elective).toBe(true);
    const k18 = pathInfo(
      'Komponente Teil 2 (16-36 Monate)\\18 - Verwaltung (§ 4 Abs. 3 Nr. 9)\\Enablers\\18a) Kunden\\18a).docx'
    );
    expect(k18.component?.excluded).toBe(true);
    expect(k18.component?.elective).toBe(true);
  });

  it('classifies scenario files with long titles and the trailing underscore', () => {
    const long = pathInfo(
      `${T1}\\Enablers\\1c_Thema\\Szenario\\Szenario_1c_Dokumente_pflegen_und_archivieren.docx`
    );
    expect(long.type).toBe('scenario');
    expect(long.key).toBe('scenario:1c');
    const plain = pathInfo(
      `${T1}\\Enablers\\1d_Thema\\Szenario\\Szenario_1d_.docx`
    );
    expect(plain.key).toBe('scenario:1d');
    const dotted = pathInfo(
      'Komponente Teil 2 (16-36 Monate)\\25.2 - Zusammenarbeit (§ 4 Abs. 4 Nr. 6)\\Enablers\\25_2d_Thema\\Szenario\\Szenario_25_2d_Fragen_stellen.docx'
    );
    expect(dotted.key).toBe('scenario:25.2d');
    expect(dotted.issues).toEqual([]);
  });

  it('accepts a scenario named like its enabler inside the Szenario folder', () => {
    const info = pathInfo(`${T1}/Enablers/1c_Thema/Szenario/1c.docx`);
    expect(info.type).toBe('scenario');
    expect(info.key).toBe('scenario:1c');
    expect(info.flags).toContain('name-variant');
    expect(info.issues).toEqual([]);
    expect(
      pathInfo(`${T1}/Enablers/1c_Thema/Szenario/Notizen.docx`).issues
    ).toContain('file-name-unrecognized');
  });

  it('flags a scenario that lies next to the enabler text', () => {
    const info = pathInfo(`${T1}\\Enablers\\1c_Thema\\Szenario_1c.docx`);
    expect(info.type).toBe('scenario');
    expect(info.flags).toContain('misplaced');
  });

  it('treats archive folders and Old_To_Delete as archive without a key', () => {
    const a = pathInfo(
      `${T2_62}\\Enablers\\6e_Rechnungen\\Enabler_Archiv_to_delete\\6e_Rechnungen_v2.docx`
    );
    expect(a.type).toBe('archive');
    expect(a.key).toBeNull();
    const b = pathInfo(
      `${T2_62}\\Enablers\\6f_Kalkulation\\6f_Old_To_Delete.docx`
    );
    expect(b.type).toBe('archive');
    expect(b.key).toBeNull();
  });

  it('reads the version suffix of an enabler text', () => {
    const info = pathInfo(
      `${T2_62}\\Enablers\\6d_Auftrag festlegen\\6d_Auftrag_festlegen_v3.docx`
    );
    expect(info.type).toBe('enabler');
    expect(info.version).toBe(3);
    expect(info.key).toBe('enabler:6.2d');
  });

  it('keeps an enabler that lies in a use case folder as enabler with a flag', () => {
    const info = pathInfo(
      'Komponente - während der gesamten Ausbildung\\21 - Sicherheit (§ 4 Abs. 4 Nr. 2)\\K21_Use-Cases\\Enabler\\21a_Arbeitsschutz_Rechte.docx'
    );
    expect(info.type).toBe('enabler');
    expect(info.key).toBe('enabler:21a');
    expect(info.flags).toContain('misplaced');
  });
});

describe('pathInfo: use cases, global quizzes, overview', () => {
  it('classifies use case files in both folder spellings', () => {
    const a = pathInfo(
      'Komponente - während der gesamten Ausbildung\\22 - Umwelt (§ 4 Abs. 4 Nr. 3)\\K22_Use-Cases\\UC_22a_Beispiel.docx'
    );
    expect(a.type).toBe('use-case');
    expect(a.key).toBe('use-case:22a');
    const b = pathInfo(
      `${T2_12}\\K12_Use-Case\\UC_12e_Zahlungseingänge kontrollieren.docx`
    );
    expect(b.type).toBe('use-case');
    expect(b.enablerKey).toBe('12e');
    const c = pathInfo(
      'Komponente Teil 1 (1-15 Monate)\\05 - Kundenbeziehungen (§ 4 Abs. 2 Nr. 5)\\K5_Use-Cases\\Ohne Musterlösung\\UC_5b_Kundendaten aufbereiten.docx'
    );
    expect(c.type).toBe('use-case');
    expect(c.key).toBe('use-case:5b');
  });

  it('reads global quizzes of the global folder and of the component folder', () => {
    const word = pathInfo(
      '00_Global_Quizze\\Word\\06.1_Global_Quiz_Auftragsbearbeitung_durchführen.docx'
    );
    expect(word.type).toBe('global-quiz');
    expect(word.group).toBe('global');
    expect(word.component?.key).toBe('06.1');
    expect(word.key).toBe('global-quiz:06.1');
    const own = pathInfo(
      `${T1}\\Global Quiz\\01_Global_Quiz_Informationsmanagement_anwenden.docx`
    );
    expect(own.type).toBe('global-quiz');
    expect(own.group).toBe('teil1');
    expect(own.key).toBe('global-quiz:01');
    expect(own.issues).toEqual([]);
  });

  it('classifies the PDF of a global quiz as pdf with its own key', () => {
    const info = pathInfo(
      '00_Global_Quizze\\PDF\\24.2_Global_Quiz_Arbeitsorganisation_und_Informationsmanagement.pdf'
    );
    expect(info.type).toBe('pdf');
    expect(info.format).toBe('pdf');
    expect(info.key).toBe('pdf:global-quiz:24.2');
  });

  it('classifies the overview file even with a byte order mark', () => {
    const info = pathInfo(
      '\ufeff00_Global_Quizze\\00_Uebersicht_Global_Quizze.md'
    );
    expect(info.type).toBe('overview');
    expect(info.key).toBe('overview');
  });

  it('reports a global quiz whose number differs from its component folder', () => {
    const info = pathInfo(
      `${T1}\\Global Quiz\\03_Global_Quiz_Buerowirtschaftliche_Ablaeufe.docx`
    );
    expect(info.issues).toContain('component-mismatch');
  });
});

describe('pathInfo: implausible names', () => {
  it('reports unknown top folders and unknown component folders', () => {
    expect(pathInfo('Irgendwas\\datei.docx').issues).toContain('unknown-group');
    const info = pathInfo(
      'Komponente Teil 1 (1-15 Monate)\\Sonstiges\\datei.docx'
    );
    expect(info.issues).toContain('unknown-component-folder');
    expect(info.type).toBe('other');
    expect(info.key).toBeNull();
  });

  it('reports a quiz file with an unknown name', () => {
    const info = pathInfo(`${T1}\\Enablers\\1a_Thema\\Quiz\\Fragen_final.docx`);
    expect(info.type).toBe('quiz');
    expect(info.key).toBeNull();
    expect(info.issues).toContain('file-name-unrecognized');
  });

  it('reports a letter in the file name that differs from the folder', () => {
    const info = pathInfo(`${T1}\\Enablers\\1a_Thema\\Quiz\\1b_Quiz_Low.docx`);
    expect(info.issues).toContain('letter-mismatch');
    expect(info.key).toBe('quiz:1a:low');
  });

  it('reports an enabler folder without a letter', () => {
    const info = pathInfo(
      `${T1}\\Enablers\\Neuer Ordner\\Quiz\\1a_Quiz_Low.docx`
    );
    expect(info.issues).toContain('enabler-folder-unrecognized');
  });

  it('reports an enabler number that does not belong to the component', () => {
    const info = pathInfo(`${T1}\\Enablers\\2a_Thema\\2a.docx`);
    expect(info.issues).toContain('component-mismatch');
  });

  it('reports a file that is not a Word document inside the quiz folder', () => {
    const info = pathInfo(`${T1}\\Enablers\\1a_Thema\\Quiz\\1a_Quiz_Low.pdf`);
    expect(info.issues).toContain('unexpected-format');
  });

  it('never throws on empty or odd input', () => {
    expect(pathInfo('').type).toBe('other');
    expect(pathInfo('\\\\').type).toBe('other');
    expect(pathInfo('datei').issues.length).toBeGreaterThan(0);
  });
});

describe('pathInfo: hardening', () => {
  it('does not take a topic word like Archivierung for an archive file', () => {
    for (const name of [
      '1a_Archivierung_und_Backup.docx',
      '1a_Datenarchivierung_v2.docx',
    ]) {
      const info = pathInfo(`${T1}\\Enablers\\1a_Thema\\${name}`);
      expect(info.type).toBe('enabler');
      expect(info.key).toBe('enabler:1a');
    }
    const folder = pathInfo(
      `${T1}\\Enablers\\1a_Thema\\Datensicherung und Archivierung\\x.docx`
    );
    expect(folder.type).not.toBe('archive');
  });

  it('still takes whole word archive markers for archive', () => {
    for (const rel of [
      `${T1}\\Enablers\\1a_Thema\\Archiv\\6a.docx`,
      `${T1}\\Enablers\\1a_Thema\\Enabler_Archiv_to_delete\\6a.docx`,
      `${T1}\\Enablers\\1a_Thema\\1a_Old_To_Delete.docx`,
      `${T1}\\Enablers\\1a_Thema\\1a_to_delete.docx`,
    ]) {
      expect(pathInfo(rel).type).toBe('archive');
    }
  });

  it('reads the version suffix of quizzes, scenarios and global quizzes', () => {
    const quiz = pathInfo(
      `${T1}\\Enablers\\1a_Thema\\Quiz\\1a_Quiz_Low_v2.docx`
    );
    expect(quiz.version).toBe(2);
    expect(quiz.key).toBe('quiz:1a:low');
    const scenario = pathInfo(
      `${T1}\\Enablers\\1a_Thema\\Szenario\\Szenario_1a_Titel_v3_final.docx`
    );
    expect(scenario.version).toBe(3);
    const global = pathInfo(`${T1}\\Global Quiz\\01_Global_Quiz_Titel_v4.docx`);
    expect(global.version).toBe(4);
  });
});

describe('globalQuizComponentKey', () => {
  it.each([
    ['06.1_Global_Quiz_Auftragsbearbeitung_durchführen.docx', '06.1'],
    [
      '24.2_Global_Quiz_Arbeitsorganisation_und_Informationsmanagement.pdf',
      '24.2',
    ],
    ['01_Global_Quiz_Informationsmanagement_anwenden.docx', '01'],
    ['17_Global_Quiz_Öffentlichkeitsarbeit.docx', '17'],
    ['00_Global_Quizze\\Word\\25.1_Global_Quiz_Zusammenarbeit.docx', '25.1'],
  ])('%s gives %s', (name, key) => {
    expect(globalQuizComponentKey(name)).toBe(key);
  });

  it('returns null for names that are not global quizzes', () => {
    expect(globalQuizComponentKey('1a_Quiz_Low.docx')).toBeNull();
    expect(globalQuizComponentKey('Global_Quiz_ohne_Nummer.docx')).toBeNull();
    expect(globalQuizComponentKey('')).toBeNull();
  });
});
