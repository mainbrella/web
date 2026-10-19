import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const initialMigration = readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8');
const boardsMigration = readFileSync(new URL('../migrations/002_boards.sql', import.meta.url), 'utf8');
const boardOwnersMigration = readFileSync(new URL('../migrations/003_board_owners.sql', import.meta.url), 'utf8');
const messageTitlesMigration = readFileSync(new URL('../migrations/004_message_titles.sql', import.meta.url), 'utf8');

function database(t: TestContext): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(initialMigration);
  return db;
}

test('boards migration preserves existing users and messages in General', t => {
  const db = database(t);
  db.prepare('INSERT INTO messages(user_id,body) VALUES(?,?)').run('alice', 'An existing user post');
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  const messages = db.prepare('SELECT id,user_id,body,created_at FROM messages ORDER BY id').all();

  db.exec(`BEGIN;\n${boardsMigration}\nCOMMIT;`);

  assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), users);
  assert.deepEqual(db.prepare('SELECT id,user_id,body,created_at FROM messages ORDER BY id').all(), messages);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE board_id='general'").get()!.n, messages.length);
  const board = db.prepare("SELECT * FROM boards WHERE id='general'").get()!;
  assert.equal(board.slug, 'general');
  assert.equal(board.name, 'General');
  assert.equal(typeof board.description, 'string');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('messages require one existing board and retain author and body constraints', t => {
  const db = database(t);
  db.exec(boardsMigration);

  assert.throws(() => db.prepare('INSERT INTO messages(user_id,body) VALUES(?,?)').run('alice', 'Missing board'), /NOT NULL/);
  const insert = db.prepare('INSERT INTO messages(board_id,user_id,body) VALUES(?,?,?)');
  assert.throws(() => insert.run(null, 'alice', 'Null board'), /NOT NULL/);
  assert.throws(() => insert.run('missing', 'alice', 'Unknown board'), /FOREIGN KEY/);
  assert.throws(() => insert.run('general', 'missing', 'Unknown author'), /FOREIGN KEY/);
  assert.throws(() => insert.run('general', 'alice', '   '), /CHECK/);
  assert.throws(() => insert.run('general', 'alice', 'x'.repeat(2001)), /CHECK/);
  assert.throws(() => db.exec("UPDATE messages SET board_id=NULL WHERE id='welcome'"), /NOT NULL/);
  assert.throws(() => db.exec("UPDATE messages SET board_id='missing' WHERE id='welcome'"), /FOREIGN KEY/);
  assert.throws(() => db.exec("DELETE FROM boards WHERE id='general'"), /FOREIGN KEY/);
});

test('boards have unique URL slugs and messages can be listed within each board', t => {
  const db = database(t);
  db.exec(boardsMigration);
  const insertBoard = db.prepare('INSERT INTO boards(slug,name,description) VALUES(?,?,?)');
  insertBoard.run('programming', 'Programming', 'Discuss software.');
  insertBoard.run('web-dev', 'Web development', 'Discuss the web.');
  assert.throws(() => insertBoard.run('programming', 'Duplicate', ''), /UNIQUE/);
  for (const slug of ['', 'Programming', 'has space', 'has/slash', '-leading', 'trailing-']) {
    assert.throws(() => insertBoard.run(slug, 'Invalid slug', ''), /CHECK/);
  }

  const board = db.prepare("SELECT id FROM boards WHERE slug='programming'").get()!;
  assert.match(String(board.id), /^[a-f0-9]{32}$/);
  db.prepare('INSERT INTO messages(board_id,user_id,body) VALUES(?,?,?)').run(board.id, 'bob', 'A programming post');
  const rows = db.prepare('SELECT * FROM messages WHERE board_id=? ORDER BY created_at DESC').all(board.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].body, 'A programming post');
  assert.match(String(rows[0].id), /^[a-f0-9]{32}$/);
  assert.ok(Number.isFinite(Date.parse(String(rows[0].created_at))));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM messages WHERE board_id='general'").get()!.n, 2);
});

test('board owners migration preserves historical rows and adds a nullable user foreign key', t => {
  const db = database(t);
  db.exec(boardsMigration);
  db.exec("INSERT INTO boards(id,slug,name) VALUES('owned','owned','Owned');");
  const boardsBefore = db.prepare('SELECT * FROM boards ORDER BY id').all();
  const messagesBefore = db.prepare('SELECT * FROM messages ORDER BY id').all();
  const usersBefore = db.prepare('SELECT * FROM users ORDER BY id').all();

  db.exec(`BEGIN;\n${boardOwnersMigration}\nCOMMIT;`);

  assert.deepEqual(db.prepare('SELECT * FROM boards ORDER BY id').all().map(row => Object.values(row)),
    boardsBefore.map(row => [...Object.values(row), null]));
  assert.deepEqual(db.prepare('SELECT * FROM messages ORDER BY id').all(), messagesBefore);
  assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), usersBefore);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => db.prepare("UPDATE boards SET user_id='missing' WHERE id='owned'").run(), /FOREIGN KEY/);
  db.prepare("UPDATE boards SET user_id='alice' WHERE id='owned'").run();
  assert.equal(db.prepare("SELECT user_id FROM boards WHERE id='owned'").get()!.user_id, 'alice');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_list(boards)').all().map((row: any) => [row.table, row.from, row.to]), [['users', 'user_id', 'id']]);
});

test('message titles migration backfills titles and preserves existing message data', t => {
  const db = database(t);
  db.exec(boardsMigration);
  db.exec(boardOwnersMigration);
  db.prepare('INSERT INTO messages(board_id,user_id,body) VALUES(?,?,?)').run('general', 'alice', `  ${'x'.repeat(205)}  `);
  const usersBefore = db.prepare('SELECT * FROM users ORDER BY id').all();
  const boardsBefore = db.prepare('SELECT * FROM boards ORDER BY id').all();
  const messagesBefore = db.prepare('SELECT id,board_id,user_id,body,created_at FROM messages ORDER BY id').all();
  const indexesBefore = db.prepare('PRAGMA index_list(messages)').all();
  const foreignKeysBefore = db.prepare('PRAGMA foreign_key_list(messages)').all();

  db.exec(`BEGIN;\n${messageTitlesMigration}\nCOMMIT;`);

  const messagesAfter = db.prepare('SELECT id,board_id,user_id,body,created_at,title FROM messages ORDER BY id').all();
  assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), usersBefore);
  assert.deepEqual(db.prepare('SELECT * FROM boards ORDER BY id').all(), boardsBefore);
  assert.deepEqual(db.prepare('SELECT id,board_id,user_id,body,created_at FROM messages ORDER BY id').all(), messagesBefore);
  assert.deepEqual(db.prepare('PRAGMA index_list(messages)').all(), indexesBefore);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_list(messages)').all(), foreignKeysBefore);
  assert.equal(messagesAfter.find(message => message.id === 'welcome')!.title, 'Welcome to the message board! Everyone can read messages. Try editing this as Alice.');
  assert.equal(messagesAfter.find(message => message.id === 'reply')!.title, 'Hi Alice! Switch to Bob to edit or delete this message. Each user can only change their own posts.');
  assert.equal(db.prepare('SELECT title FROM messages WHERE body=?').get(`  ${'x'.repeat(205)}  `)!.title, 'x'.repeat(200));
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('message titles have a default and enforce title constraints', t => {
  const db = database(t);
  db.exec(boardsMigration);
  db.exec(boardOwnersMigration);
  db.exec(messageTitlesMigration);

  const insert = db.prepare('INSERT INTO messages(board_id,user_id,body) VALUES(?,?,?)');
  insert.run('general', 'alice', 'Post created by an older client');
  assert.equal(db.prepare("SELECT title FROM messages WHERE body='Post created by an older client'").get()!.title, 'Untitled');
  db.prepare("UPDATE messages SET title='A chosen title' WHERE body='Post created by an older client'").run();
  assert.equal(db.prepare("SELECT title FROM messages WHERE body='Post created by an older client'").get()!.title, 'A chosen title');

  const insertWithTitle = db.prepare('INSERT INTO messages(board_id,user_id,body,title) VALUES(?,?,?,?)');
  insertWithTitle.run('general', 'bob', 'A titled post', 'x'.repeat(200));
  assert.equal(db.prepare("SELECT title FROM messages WHERE body='A titled post'").get()!.title, 'x'.repeat(200));
  assert.throws(() => insertWithTitle.run('general', 'alice', 'Empty title', ''), /CHECK/);
  assert.throws(() => insertWithTitle.run('general', 'alice', 'Blank title', '  '), /CHECK/);
  assert.throws(() => insertWithTitle.run('general', 'alice', 'Long title', 'x'.repeat(201)), /CHECK/);
  assert.throws(() => insertWithTitle.run('general', 'alice', 'Null title', null), /NOT NULL/);
  assert.throws(() => db.exec("UPDATE messages SET title='' WHERE id='welcome'"), /CHECK/);
  assert.throws(() => db.exec("UPDATE messages SET title=NULL WHERE id='welcome'"), /NOT NULL/);
});
