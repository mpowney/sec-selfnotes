import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { serverDecrypt, serverEncrypt, isSce1 } from '../src/crypto.ts';
import { categoryDir, NoteStorage } from '../src/storage.ts';
import { openDb } from '../src/db.ts';

const sce1 = () => Buffer.concat([Buffer.from('SCE1'), randomBytes(12 + 16 + 5)]);
const ID = '11111111-1111-4111-8111-111111111111';

test('server layer round-trips and binds to note id', () => {
  const key = randomBytes(32);
  const data = sce1();
  const enc = serverEncrypt(key, ID, data);
  assert.ok(serverDecrypt(key, ID, enc).equals(data));
  assert.throws(() => serverDecrypt(key, '22222222-2222-4222-8222-222222222222', enc));
  assert.ok(isSce1(data));
  assert.ok(!isSce1(Buffer.from('# plaintext markdown note here')));
});

test('category directory names are sanitised', () => {
  assert.equal(categoryDir('../../etc'), 'etc');
  assert.equal(categoryDir('Work Stuff'), 'work-stuff');
  assert.equal(categoryDir('///'), 'uncategorized');
});

test('storage writes, moves, reads and reconciles', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
  const cfg: any = { dataDir, systemKey: randomBytes(32) };
  const storage = new NoteStorage(cfg);
  const db = openDb(dataDir);
  db.prepare('INSERT INTO users VALUES (?,?,?)').run('u', 'bob', 1);
  db.prepare('INSERT INTO notes VALUES (?,?,?,?,?,?)').run(ID, 'u', 't', 'work', 1, 1);
  const data = sce1();
  storage.write('work', ID, data);
  assert.ok(fs.existsSync(path.join(dataDir, 'notes', 'work', `${ID}.md`)));
  assert.ok(!fs.readFileSync(path.join(dataDir, 'notes', 'work', `${ID}.md`)).includes(data));
  storage.move('work', 'uncategorized', ID);
  assert.ok(storage.read('uncategorized', ID).equals(data));
  assert.equal(storage.reconcile(db).removed, 1);
});

test('uploads are encrypted per note, moved with the note and removed with it', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
  const storage = new NoteStorage({ dataDir, systemKey: randomBytes(32) } as any);
  const FILE = '33333333-3333-4333-8333-333333333333';
  const data = sce1();
  storage.write('work', ID, data);
  storage.writeUpload('work', ID, FILE, data);
  const onDisk = path.join(dataDir, 'notes', 'work', ID, 'uploads', FILE);
  assert.ok(fs.existsSync(onDisk));
  assert.ok(!fs.readFileSync(onDisk).includes(data));
  storage.move('work', 'home', ID);
  assert.ok(storage.readUpload('home', ID, FILE).equals(data));
  assert.throws(() => storage.readUpload('home', ID, '../x'));
  storage.remove('home', ID);
  assert.ok(!fs.existsSync(path.join(dataDir, 'notes', 'home', ID)));
});
