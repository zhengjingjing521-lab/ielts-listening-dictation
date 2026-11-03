"""Unified manual and automatically collected words, isolated from the journal."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sqlite3
from spellings import DEFAULT_SPELLINGS


TZ = timezone(timedelta(hours=8))


class Wordbook:
    def __init__(self, path, groups, spellings=DEFAULT_SPELLINGS):
        self.spellings = spellings
        self.path = Path(path)
        self.groups = groups
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('''CREATE TABLE IF NOT EXISTS entries (
                key TEXT PRIMARY KEY NOT NULL,
                word TEXT NOT NULL,
                group_id TEXT NOT NULL,
                word_index INTEGER NOT NULL,
                wrong_spellings TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                active INTEGER NOT NULL CHECK(active IN (0, 1))
            )''')
            db.execute('''CREATE TABLE IF NOT EXISTS auto_events (
                event_id TEXT PRIMARY KEY NOT NULL,
                fingerprint TEXT NOT NULL
            )''')
            db.execute('''CREATE TABLE IF NOT EXISTS migrations (
                name TEXT PRIMARY KEY NOT NULL
            )''')

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA synchronous=FULL')
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def entry(row):
        return dict(key=row['key'], word=row['word'], group=row['group_id'],
                    index=row['word_index'], wrongSpellings=json.loads(row['wrong_spellings']),
                    createdAt=row['created_at'], updatedAt=row['updated_at'])

    def _items(self, db):
        return [self.entry(row) for row in db.execute('SELECT * FROM entries WHERE active=1 ORDER BY rowid')]

    def items(self):
        with self.connection() as db:
            return self._items(db)

    @staticmethod
    def normalized(text):
        return ' '.join(text.strip().lower().split())

    @staticmethod
    def raw_spelling_valid(text):
        # Keep copied formatting and control characters as data, exactly as
        # judged. JSON escapes controls and the UI renders spelling as text.
        # Isolated UTF-16 surrogates cannot be safely persisted as UTF-8.
        return (isinstance(text, str) and len(text) <= 120
                and not any(0xD800 <= ord(char) <= 0xDFFF for char in text))

    def _validate(self, payload):
        if not isinstance(payload, dict):
            raise ValueError('错词本内容无效')
        action = payload.get('action')
        group_id = payload.get('group')
        index = payload.get('index')
        if not isinstance(action, str) or action not in ('add', 'remove', 'auto'):
            raise ValueError('错词本操作无效')
        if not isinstance(group_id, str) or group_id not in self.groups:
            raise ValueError('分组无效')
        group = self.groups[group_id]
        if type(index) is not int or not 0 <= index < len(group['words']):
            raise ValueError('词号无效')
        wrong = payload.get('wrongSpelling', '')
        event_id = None
        if action == 'auto':
            event_id = payload.get('eventId')
            if not isinstance(event_id, str) or not re.fullmatch(r'[A-Za-z0-9:._-]{1,200}', event_id):
                raise ValueError('自动收录编号无效')
            if not self.raw_spelling_valid(wrong):
                raise ValueError('原拼写须不超过120个字符，且不含孤立代理码')
        else:
            if not isinstance(wrong, str) or len(wrong) > 120 or not re.fullmatch(r"[A-Za-z'’ \-]*", wrong):
                raise ValueError('错拼请填写不超过120个英文字符、空格、撇号或连字符')
            wrong = wrong.strip()
        word = group['words'][index]
        return action, group_id, index, wrong, word, self.normalized(word), event_id

    def update(self, payload):
        values = self._validate(payload)
        with self.connection() as db:
            # Serialize read/merge/write across requests and separate server processes.
            db.execute('BEGIN IMMEDIATE')
            return self._apply(db, values)

    def _apply(self, db, values):
        action, group_id, index, wrong, word, key, event_id = values
        prior = db.execute('SELECT * FROM entries WHERE key=?', (key,)).fetchone()
        if event_id:
            fingerprint = json.dumps([group_id, index, wrong], ensure_ascii=False)
            event = db.execute('SELECT fingerprint FROM auto_events WHERE event_id=?', (event_id,)).fetchone()
            if event:
                if event['fingerprint'] != fingerprint:
                    raise ValueError('同一自动收录编号不能提交不同内容')
                result = dict(items=self._items(db))
                if prior and prior['active']:
                    result['item'] = self.entry(prior)
                return result
            db.execute('INSERT INTO auto_events(event_id, fingerprint) VALUES (?, ?)', (event_id, fingerprint))
            if self.normalized(wrong) in self.spellings.get(word, {}):
                return dict(items=self._items(db))
        stamp = datetime.now(TZ).isoformat(timespec='milliseconds')
        if action == 'remove':
            if prior and prior['active']:
                db.execute('UPDATE entries SET active=0, updated_at=? WHERE key=?', (stamp, key))
            return dict(items=self._items(db))

        if prior:
            mistakes = json.loads(prior['wrong_spellings'])
            changed = bool(wrong and wrong not in mistakes)
            if changed:
                mistakes.append(wrong)
            if changed or not prior['active']:
                db.execute('UPDATE entries SET wrong_spellings=?, active=1, updated_at=? WHERE key=?',
                           (json.dumps(mistakes, ensure_ascii=False), stamp, key))
        else:
            mistakes = [wrong] if wrong else []
            db.execute('''INSERT INTO entries
                (key, word, group_id, word_index, wrong_spellings, created_at, updated_at, active)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)''',
                (key, word, group_id, index, json.dumps(mistakes, ensure_ascii=False), stamp, stamp))
        row = db.execute('SELECT * FROM entries WHERE key=?', (key,)).fetchone()
        return dict(items=self._items(db), item=self.entry(row))

    def legacy_imported(self):
        with self.connection() as db:
            return db.execute("SELECT 1 FROM migrations WHERE name='unified-wordbook-1.1.1'").fetchone() is not None

    def _legacy_spelling(self, value, word):
        return value if self.raw_spelling_valid(value) and self.normalized(value) != self.normalized(word) else ''

    def _legacy_events(self, sheet_state, journal_rows):
        errors = sheet_state.get('errors', {})
        progress = sheet_state.get('progress', {})
        if not isinstance(errors, dict) or not isinstance(progress, dict):
            raise ValueError('看词练习记录格式无效，尚未迁移错词本')
        events = []
        for word, error in errors.items():
            if not isinstance(error, dict):
                continue
            try:
                group_id, index = error.get('group'), error.get('index')
                values = self._validate(dict(action='auto', eventId='legacy-sheet', group=group_id, index=index))
                if word != values[4]:
                    continue
                first, last, count = error.get('first'), error.get('last'), error.get('count')
                if not all(isinstance(day, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', day) and date.fromisoformat(day).isoformat() == day for day in (first, last)):
                    continue
                if first > last or type(count) is not int or not 1 <= count <= 9007199254740991:
                    continue
                row = progress.get(group_id, {})
                row = row.get(word, {}) if isinstance(row, dict) else {}
                wrong = self._legacy_spelling(row.get('en') if isinstance(row, dict) else None, word)
                event = dict(action='auto', eventId=f'legacy-sheet:{group_id}:{index}:{first}:{last}:{count}',
                             group=group_id, index=index, wrongSpelling=wrong)
                events.append((self._validate(event), None))
            except (ValueError, TypeError):
                continue

        latest = {}
        for row in journal_rows:
            if not isinstance(row, dict):
                continue
            group_id = row.get('groupId')
            if not isinstance(group_id, str) or group_id not in self.groups:
                continue
            number = row.get('wordNumber')
            if type(number) is not int:
                continue
            index = number - self.groups[group_id].get('start', 1)
            try:
                values = self._validate(dict(action='auto', eventId='legacy-attempt', group=group_id, index=index))
            except ValueError:
                continue
            if row.get('word') != values[4] or row.get('result') not in ('正确', '拼写错误', '未听出'):
                continue
            latest[values[5]] = (row, group_id, index)
        for row, group_id, index in latest.values():
            record_id = row.get('id')
            if row['result'] == '正确' or not isinstance(record_id, str) or not re.fullmatch(r'[0-9a-f-]{36}', record_id):
                continue
            wrong = '' if row['result'] == '未听出' else self._legacy_spelling(row.get('answer'), row['word'])
            values = self._validate(dict(action='auto', eventId='legacy-attempt:' + record_id,
                                         group=group_id, index=index, wrongSpelling=wrong))
            events.append((values, 'attempt:' + record_id))
        return events

    def import_legacy(self, sheet_state, journal_rows):
        """Import the pre-upgrade snapshot once, without changing either source."""
        if not isinstance(sheet_state, dict) or not isinstance(journal_rows, list):
            raise ValueError('旧练习记录格式无效，尚未迁移错词本')
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            if db.execute("SELECT 1 FROM migrations WHERE name='unified-wordbook-1.1.1'").fetchone():
                return dict(items=self._items(db))
            for values, equivalent_event in self._legacy_events(sheet_state, journal_rows):
                if equivalent_event and db.execute('SELECT 1 FROM auto_events WHERE event_id=?', (equivalent_event,)).fetchone():
                    continue
                self._apply(db, values)
            db.execute("INSERT INTO migrations(name) VALUES ('unified-wordbook-1.1.1')")
            return dict(items=self._items(db))
