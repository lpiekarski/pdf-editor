import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const candidates = ['.venv/Scripts/python.exe', '.venv/bin/python'];
export const python = candidates.find((p) => existsSync(p));
/** Python validators (pyHanko/pikepdf) are optional locally; tests using them are skipped without the venv. */
export const hasPython = !!python;

export const OUT_DIR = 'tests/output';
export function writeOut(name: string, bytes: Uint8Array): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const p = join(OUT_DIR, name);
  writeFileSync(p, bytes);
  return p;
}

export function pyValidate(cmd: 'check' | 'sigs', file: string, trust?: string, password = ''): any {
  const args = ['tools/validate.py', cmd, file, ...(trust ? [trust] : [])];
  return JSON.parse(execFileSync(python!, args, { encoding: 'utf8', env: { ...process.env, PDF_PASSWORD: password } }));
}

export const TEST_CA = 'tests/fixtures/certs/ca.crt';
