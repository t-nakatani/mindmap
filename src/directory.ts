// 名簿。Durable Object `main` の中だけで動く。アカウント・領域・共有を SQLite に持つ。
// - アカウントは Google の sub（変わらない利用者番号）に結び付ける。メールアドレスは表示と共有の指定に使い、ログインのたびに書き換える。
//   まだログインしたことのない人に共有するときは、sub のないアカウントをメールアドレスだけで作り、初めてのログインで sub を結ぶ。
// - 領域はマップの置き場で、Durable Object `space:<領域ID>` に入る。今は1人1領域。
// - 共有は領域を閲覧者に読み取り専用で見せる。
// 手元で認証なしのときは、領域は `local`（この `main` 自身）の1つだけで、共有はない。

export const LOCAL_SPACE = 'local';
export type Role = 'owner' | 'viewer';
export type Account = { id: string; sub: string | null; email: string | null };
export interface SpaceInfo { id: string; owner: string; role: Role }

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** 推測しにくい ID。prefix のあとに、紛らわしい文字を除いた 12 文字を続ける。 */
export function newId(prefix: string): string {
  let s = prefix;
  for (const b of crypto.getRandomValues(new Uint8Array(12))) s += ID_ALPHABET[b & 31];
  return s;
}

export function cleanEmail(v: unknown): string {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+$/.test(s)) throw new Error(`メールアドレスとして読めません: ${String(v ?? '')}`);
  return s;
}

export class Directory {
  sql: SqlStorage;
  /** 既存マップを持ち主の領域へ移している最中のもの。終わるまで、その領域へのリクエストを待たせる。 */
  seeding = new Map<string, Promise<void>>();

  constructor(sql: SqlStorage) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, sub TEXT UNIQUE, email TEXT UNIQUE,
      created_at INTEGER NOT NULL)`);
    sql.exec('CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL)');
    sql.exec(`CREATE TABLE IF NOT EXISTS shares (space_id TEXT NOT NULL, account_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (space_id, account_id))`);
    sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  }

  // ---------- アカウント ----------

  account(id: string): Account | null {
    return this.sql.exec<Account>('SELECT id, sub, email FROM accounts WHERE id = ?', id).toArray()[0] ?? null;
  }
  accountByEmail(email: string): Account | null {
    return this.sql.exec<Account>('SELECT id, sub, email FROM accounts WHERE email = ?', email).toArray()[0] ?? null;
  }
  /** メールアドレスのアカウント。無ければ sub なしで作る（初めてのログインで sub を結ぶ）。 */
  ensureAccountByEmail(email: string): Account {
    const found = this.accountByEmail(email);
    if (found) return found;
    const id = newId('a_');
    this.sql.exec('INSERT INTO accounts (id, sub, email, created_at) VALUES (?, NULL, ?, ?)', id, email, Date.now());
    return { id, sub: null, email };
  }
  /** Google でログインした人のアカウント。sub で探し、無ければ同じメールアドレスの sub なしのアカウントに結ぶ。 */
  login(sub: string, email: string): Account {
    const bySub = this.sql.exec<Account>('SELECT id, sub, email FROM accounts WHERE sub = ?', sub).toArray()[0];
    const byEmail = this.accountByEmail(email);
    if (bySub) {
      if (byEmail && byEmail.id !== bySub.id) {
        // メールアドレスを変えた人が、そのアドレス宛ての共有を先に受けていた。共有と領域をこちらへまとめる
        if (byEmail.sub === null) this.merge(byEmail.id, bySub.id);
        else this.sql.exec('UPDATE accounts SET email = NULL WHERE id = ?', byEmail.id);
      }
      if (bySub.email !== email) this.sql.exec('UPDATE accounts SET email = ? WHERE id = ?', email, bySub.id);
      return { ...bySub, email };
    }
    if (byEmail && byEmail.sub === null) {
      this.sql.exec('UPDATE accounts SET sub = ? WHERE id = ?', sub, byEmail.id);
      return { ...byEmail, sub };
    }
    // 同じアドレスを別の Google アカウントが使っていた（アドレスが付け替えられた）。古いほうからアドレスを外す
    if (byEmail) this.sql.exec('UPDATE accounts SET email = NULL WHERE id = ?', byEmail.id);
    const id = newId('a_');
    this.sql.exec('INSERT INTO accounts (id, sub, email, created_at) VALUES (?, ?, ?, ?)', id, sub, email, Date.now());
    return { id, sub, email };
  }
  merge(from: string, into: string) {
    this.sql.exec(`INSERT OR IGNORE INTO shares (space_id, account_id, created_at)
      SELECT space_id, ?, created_at FROM shares WHERE account_id = ?`, into, from);
    this.sql.exec('DELETE FROM shares WHERE account_id = ?', from);
    this.sql.exec('UPDATE spaces SET owner_id = ? WHERE owner_id = ?', into, from);
    this.sql.exec('DELETE FROM accounts WHERE id = ?', from);
  }

  // ---------- 領域 ----------

  ownSpaceId(accountId: string): string | null {
    return this.sql.exec<{ id: string }>('SELECT id FROM spaces WHERE owner_id = ? ORDER BY created_at, id LIMIT 1', accountId)
      .toArray()[0]?.id ?? null;
  }
  /** アカウントの領域。無ければ作る。 */
  ensureOwnSpace(accountId: string): string {
    const found = this.ownSpaceId(accountId);
    if (found) return found;
    const id = newId('s_');
    this.sql.exec('INSERT INTO spaces (id, owner_id, created_at) VALUES (?, ?, ?)', id, accountId, Date.now());
    return id;
  }
  role(spaceId: string, accountId: string): Role | null {
    const space = this.sql.exec<{ owner_id: string }>('SELECT owner_id FROM spaces WHERE id = ?', spaceId).toArray()[0];
    if (!space) return null;
    if (space.owner_id === accountId) return 'owner';
    return this.sql.exec('SELECT 1 FROM shares WHERE space_id = ? AND account_id = ?', spaceId, accountId).toArray().length ? 'viewer' : null;
  }
  /** 開ける領域。自分の領域が先で、共有されたものが持ち主のメールアドレス順に続く。 */
  spaces(accountId: string): SpaceInfo[] {
    const own = this.ensureOwnSpace(accountId);
    const shared = this.sql.exec<{ id: string; owner: string | null }>(`SELECT s.id, a.email AS owner FROM shares sh
      JOIN spaces s ON s.id = sh.space_id JOIN accounts a ON a.id = s.owner_id WHERE sh.account_id = ? ORDER BY a.email`, accountId).toArray();
    return [{ id: own, owner: this.account(accountId)?.email ?? '', role: 'owner' as Role },
      ...shared.map(r => ({ id: r.id, owner: r.owner ?? '', role: 'viewer' as Role }))];
  }

  // ---------- 共有 ----------

  shares(spaceId: string): { email: string; since: string }[] {
    return this.sql.exec<{ email: string | null; created_at: number }>(`SELECT a.email, sh.created_at FROM shares sh
      JOIN accounts a ON a.id = sh.account_id WHERE sh.space_id = ? ORDER BY a.email`, spaceId).toArray()
      .map(r => ({ email: r.email ?? '', since: new Date(r.created_at).toISOString() }));
  }
  share(spaceId: string, accountId: string) {
    this.sql.exec('INSERT OR IGNORE INTO shares (space_id, account_id, created_at) VALUES (?, ?, ?)', spaceId, accountId, Date.now());
  }
  unshare(spaceId: string, accountId: string): boolean {
    const had = this.sql.exec('SELECT 1 FROM shares WHERE space_id = ? AND account_id = ?', spaceId, accountId).toArray().length > 0;
    this.sql.exec('DELETE FROM shares WHERE space_id = ? AND account_id = ?', spaceId, accountId);
    return had;
  }

  // ---------- 既存マップの移し替え ----------
  // 領域を分ける前のマップは `main` の maps 表にある。OWNER_EMAIL の人の領域へ一度だけ写し、元の行は控えとして残す。

  legacyPending(): boolean {
    if (this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'legacy_moved_to'").toArray()[0]) return false;
    return this.sql.exec('SELECT 1 FROM maps LIMIT 1').toArray().length > 0;
  }
  legacyRows(): { name: string; data: string; version: number }[] {
    return this.sql.exec<{ name: string; data: string; version: number }>('SELECT name, data, version FROM maps').toArray();
  }
  legacyCurrent(): string | null {
    return this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'current'").toArray()[0]?.value ?? null;
  }
  markLegacyMoved(spaceId: string) {
    this.sql.exec("INSERT INTO meta (key, value) VALUES ('legacy_moved_to', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", spaceId);
  }
}
