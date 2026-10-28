// Converts a Word file to a PDF with a local LibreOffice (headless), for the mode --from-word of
// scripts/import/kfbm-documents.mjs. Nothing here talks to a database or to the storage.
//
// The conversion is done by a program on this machine. It is started as follows:
//  - one file after the other, one new program per file, no shell (arguments as a list)
//  - with an own user profile in the temp folder of the run, so a LibreOffice of the person is not
//    touched and no setting of the person is used. The profile switches off macros (security level
//    "very high", execution disabled), the update of links and fields (links: never), and points the
//    proxy settings (org.openoffice.Inet/Settings) at a closed local port. The docx that arrives here
//    has its external references removed (word.ts), these settings are the second line. LibreOffice
//    itself is not cut off from the network: run it on a machine without a route to hostile hosts if
//    the Word files are not your own
//  - with a small environment (no connection string, no key, nothing of the run is handed over)
//  - with a time limit per file. At the limit the whole process tree is ended (taskkill /T /F on
//    Windows, the process group elsewhere) and the file counts as failed
//  - the input is a copy with a short name in the temp folder, so a path of the source above 259
//    characters or an OneDrive placeholder never reaches the program
//
// Word itself (COM) would be the alternative on a machine with Office; it is not used here.

import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CANDIDATES = {
  win32: [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ],
  darwin: ['/Applications/LibreOffice.app/Contents/MacOS/soffice'],
  linux: ['/usr/bin/soffice', '/usr/lib/libreoffice/program/soffice'],
};

const SOFFICE_NAME = /^soffice(?:\.exe)?$/i;

/**
 * The LibreOffice program: the given path, or KFBM_SOFFICE, or a standard place. Returns the path
 * or an error text. The file must be named soffice(.exe) (a wrong file is never started).
 */
export function findSoffice(
  explicit,
  env = process.env,
  exists = existsSync,
  platform = process.platform
) {
  const given = explicit ?? env.KFBM_SOFFICE ?? null;
  const list = given ? [given] : (CANDIDATES[platform] ?? []);
  const flavour = platform === 'win32' ? path.win32 : path.posix;
  for (const candidate of list) {
    // an absolute path on this machine, never a name that the working directory could answer, and
    // no network share
    if (!flavour.isAbsolute(candidate) || /^[\\/]{2}/.test(candidate)) {
      return { error: 'The program needs an absolute path on this machine.' };
    }
    if (!SOFFICE_NAME.test(flavour.basename(candidate))) {
      return { error: 'The program must be named soffice (soffice.exe).' };
    }
    if (exists(candidate)) return { path: candidate };
  }
  return {
    error: given
      ? 'The LibreOffice program was not found at the given path.'
      : 'LibreOffice was not found (use --soffice <path> or KFBM_SOFFICE).',
  };
}

/** Settings of the own profile (registrymodifications.xcu). */
export const PROFILE_SETTINGS = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Field" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetProxyType" oor:op="fuse"><value>2</value></prop></item>
<item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetHTTPProxyName" oor:op="fuse"><value>127.0.0.1</value></prop></item>
<item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetHTTPProxyPort" oor:op="fuse"><value>9</value></prop></item>
<item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetHTTPSProxyName" oor:op="fuse"><value>127.0.0.1</value></prop></item>
<item oor:path="/org.openoffice.Inet/Settings"><prop oor:name="ooInetHTTPSProxyPort" oor:op="fuse"><value>9</value></prop></item>
</oor:items>
`;

const ENV_KEEP = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'windir',
  'ComSpec',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'LANG',
  'LC_ALL',
];

/** The small environment of the program: only what a program needs to start, nothing else. */
export function cleanEnvironment(env = process.env) {
  const out = {};
  for (const key of ENV_KEEP) {
    if (typeof env[key] === 'string') out[key] = env[key];
  }
  return out;
}

/** Arguments of one conversion (a list, never a command line). */
export function convertArguments(profileDir, outDir, inputFile) {
  return [
    '--headless',
    '--invisible',
    '--norestore',
    '--nolockcheck',
    '--nodefault',
    '--nologo',
    '--nofirststartwizard',
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    '--convert-to',
    'pdf:writer_pdf_Export',
    '--outdir',
    outDir,
    inputFile,
  ];
}

/** The taskkill of the system folder, not whatever the search path finds first. */
export function taskkillPath(env = process.env) {
  return path.win32.join(
    env.SystemRoot ?? env.windir ?? 'C:\\Windows',
    'System32',
    'taskkill.exe'
  );
}

/** Ends a process and all its children, at once (for the end of the run). Never throws. */
export function killTreeSync(pid, platform = process.platform) {
  try {
    if (platform === 'win32') {
      spawnSync(taskkillPath(), ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
      });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // the process is gone or cannot be reached
  }
}

/** Ends a process and all its children. Resolves when the end was asked for, never throws. */
export function killTree(pid, platform = process.platform, spawnImpl = spawn) {
  return new Promise(resolve => {
    try {
      if (platform === 'win32') {
        const killer = spawnImpl(
          taskkillPath(),
          ['/PID', String(pid), '/T', '/F'],
          {
            stdio: 'ignore',
            windowsHide: true,
            shell: false,
          }
        );
        killer.on('error', () => resolve());
        killer.on('close', () => resolve());
      } else {
        process.kill(-pid, 'SIGKILL');
        resolve();
      }
    } catch {
      resolve();
    }
  });
}

/** A temp folder for one run. The path must stay short (LibreOffice and Windows both dislike long ones). */
export function createWorkspace(prefix = 'kfbm-word-pdf-') {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  if (root.length > 120) {
    rmSync(root, { recursive: true, force: true });
    throw new Error(
      'The temp folder path is too long, set TEMP to a shorter folder.'
    );
  }
  for (const dir of ['in', 'out', 'final', 'profile/user']) {
    mkdirSync(path.join(root, ...dir.split('/')), { recursive: true });
  }
  writeFileSync(
    path.join(root, 'profile', 'user', 'registrymodifications.xcu'),
    PROFILE_SETTINGS,
    'utf8'
  );
  return {
    root,
    inDir: path.join(root, 'in'),
    outDir: path.join(root, 'out'),
    finalDir: path.join(root, 'final'),
    profileDir: path.join(root, 'profile'),
    cleanup() {
      rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    },
  };
}

/**
 * The converter. `convert(inputFile, outputFile)` converts one docx to a PDF and resolves with
 * { ok: true } or { ok: false, code } (TIMEOUT, SPAWN, EXIT, NO_OUTPUT, IO). It never throws.
 * `spawnImpl` and `kill` are replaced by the tests.
 */
export function createLibreOfficeConverter({
  soffice,
  workspace,
  timeoutMs = 120000,
  spawnImpl = spawn,
  kill = killTree,
  killSync = killTreeSync,
  killGraceMs = 5000,
  env = process.env,
  platform = process.platform,
}) {
  let current = null;
  const remove = file => {
    try {
      rmSync(file, { force: true });
    } catch {
      // a file that cannot be removed now goes with the temp folder
    }
  };
  return {
    /** Ends a conversion that is running (Ctrl+C), at once. */
    abort() {
      if (current?.pid) killSync(current.pid, platform);
    },
    async convert(inputFile, outputFile) {
      const expected = path.join(
        workspace.outDir,
        `${path.basename(inputFile, path.extname(inputFile))}.pdf`
      );
      remove(expected);
      const outcome = await new Promise(resolve => {
        let child;
        let timedOut = false;
        let finished = false;
        const done = value => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(async () => {
          timedOut = true;
          try {
            if (child?.pid) await kill(child.pid, platform);
          } catch {
            // the grace period below ends the wait
          }
          // the process did not report its end after the kill: give up on it
          setTimeout(() => done({ timedOut: true }), killGraceMs).unref?.();
        }, timeoutMs);
        try {
          child = spawnImpl(
            soffice,
            convertArguments(workspace.profileDir, workspace.outDir, inputFile),
            {
              stdio: 'ignore',
              windowsHide: true,
              shell: false,
              detached: platform !== 'win32',
              env: cleanEnvironment(env),
            }
          );
        } catch {
          done({ spawnError: true });
          return;
        }
        current = child;
        child.on('error', () => done({ spawnError: true }));
        child.on('close', code => done({ code, timedOut }));
      });
      current = null;
      if (outcome.timedOut) {
        remove(expected);
        return { ok: false, code: 'TIMEOUT' };
      }
      if (outcome.spawnError) return { ok: false, code: 'SPAWN' };
      if (outcome.code !== 0) {
        remove(expected);
        return { ok: false, code: 'EXIT' };
      }
      if (!existsSync(expected)) return { ok: false, code: 'NO_OUTPUT' };
      try {
        renameSync(expected, outputFile);
      } catch {
        remove(expected);
        return { ok: false, code: 'IO' };
      }
      return { ok: true };
    },
  };
}
