"""数据库访问层：SQLite 连接、事务与初始化。"""
from __future__ import annotations

import os
import sqlite3
import threading

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER_DIR = os.path.join(BASE_DIR, 'server')
DATA_DIR = os.path.abspath(os.environ.get('STORE_DATA_DIR') or os.path.join(BASE_DIR, 'data'))
DB_PATH = os.path.abspath(os.environ.get('STORE_DB_PATH') or os.path.join(DATA_DIR, 'store.db'))
SCHEMA_PATH = os.path.join(SERVER_DIR, 'schema.sql')

_local = threading.local()


def get_db() -> sqlite3.Connection:
    conn = getattr(_local, 'conn', None)
    if conn is None:
        os.makedirs(DATA_DIR, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, timeout=20, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys = ON')
        conn.execute('PRAGMA journal_mode = WAL')
        conn.execute('PRAGMA synchronous = NORMAL')
        _local.conn = conn
    return conn


def close_db() -> None:
    conn = getattr(_local, 'conn', None)
    if conn is not None:
        try:
            conn.close()
        except Exception:
            pass
        _local.conn = None


class Tx:
    """显式事务：with Tx() as conn: ...（异常自动回滚）"""

    def __enter__(self) -> sqlite3.Connection:
        self.conn = get_db()
        self.conn.execute('BEGIN IMMEDIATE')
        return self.conn

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self.conn.execute('COMMIT')
        else:
            self.conn.execute('ROLLBACK')
        return False


def row_to_dict(row):
    if row is None:
        return None
    if isinstance(row, dict):
        return row
    return {k: row[k] for k in row.keys()}


def rows_to_dict(rows):
    return [row_to_dict(r) for r in rows]


def money(value) -> float:
    try:
        return round(float(value) + 1e-9, 2)
    except (TypeError, ValueError):
        return 0.0


def query(sql: str, params=()) -> list[sqlite3.Row]:
    return get_db().execute(sql, params).fetchall()


def query_one(sql: str, params=()):
    return get_db().execute(sql, params).fetchone()


def scalar(sql: str, params=(), default=0):
    row = query_one(sql, params)
    if row is None:
        return default
    value = row[0]
    return default if value is None else value


def execute(sql: str, params=()) -> sqlite3.Cursor:
    return get_db().execute(sql, params)


def insert(sql: str, params=()) -> int:
    cur = get_db().execute(sql, params)
    return cur.lastrowid


def migrate() -> None:
    """幂等迁移：为已存在的库补上后加的表（不重建、不动业务数据）。"""
    conn = sqlite3.connect(DB_PATH, timeout=10)
    try:
        conn.execute('CREATE TABLE IF NOT EXISTS InviteCode ('
                     '  InviteID     INTEGER PRIMARY KEY AUTOINCREMENT,'
                     "  Code         TEXT NOT NULL UNIQUE,"
                     "  Role         TEXT NOT NULL DEFAULT 'Salesperson',"
                     '  MaxUses      INTEGER NOT NULL DEFAULT 1,'
                     '  UsedCount    INTEGER NOT NULL DEFAULT 0,'
                     '  ExpiresAt    TEXT,'
                     "  RecordStatus TEXT NOT NULL DEFAULT 'A',"
                     '  CreatedBy    INTEGER,'
                     "  CreatedAt    TEXT NOT NULL DEFAULT (datetime('now','localtime')),"
                     '  LastUsedAt   TEXT)')
        conn.commit()
    finally:
        conn.close()


def init_db(force: bool = False) -> None:
    """建库并灌入演示数据。已存在数据时不做任何破坏性动作（force=True 才重建）。"""
    os.makedirs(DATA_DIR, exist_ok=True)
    close_db()
    if force:
        for suffix in ('', '-wal', '-shm'):
            p = DB_PATH + suffix
            if os.path.exists(p):
                os.remove(p)

    if os.path.exists(DB_PATH):
        try:
            probe = sqlite3.connect(DB_PATH, timeout=10)
            ready = probe.execute('SELECT COUNT(*) FROM Employee').fetchone()[0]
            probe.close()
            if ready:
                return
        except sqlite3.Error:
            pass

    conn = sqlite3.connect(DB_PATH, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = OFF')
    with open(SCHEMA_PATH, 'r', encoding='utf-8') as fp:
        sql = fp.read()
    conn.executescript(sql)
    conn.execute('PRAGMA foreign_keys = ON')
    conn.close()

    from server import seed
    seed.seed_all()
    close_db()

