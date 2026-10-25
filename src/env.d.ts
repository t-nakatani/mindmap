// wrangler types が拾わない secret（wrangler secret put で入れる）。手元では .dev.vars に書く。
interface Env {
  /** Google の OAuth クライアント。無ければ Google ログインはできない（手元では認証なしになる）。 */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Google ログインで通すメールアドレス（カンマ区切り）。 */
  ALLOWED_EMAILS?: string;
  /** CLI とエージェントが Authorization: Bearer に付けるトークン。 */
  API_TOKEN?: string;
}
