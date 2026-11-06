//! マインドマップを名前指定で操作する CLI。Cloudflare の Worker の API を呼ぶだけの薄いクライアント。
//! 書き込み（/api/op）も、show・export の文字（/api/outline）もサーバー側で作る。
//! だからマップの形やノードの解決を、ここで持たない。ページには WebSocket で即時に反映される。

use chrono::{DateTime, Local};
use serde_json::{json, Map, Value};
use std::env;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Duration;

const DEFAULT_URL: &str = "http://127.0.0.1:4381";

const USAGE: &str = "使い方: mindmap <コマンド> [引数] [オプション]

  maps                                 マップの一覧。* が今選んでいるもの
  use <マップ名>                       操作と画面の対象にするマップを切り替える
  new <題名> --map <マップ名>          新しいマップを作る。切り替えは use で
  show [ノード]                        階層を ID と状態つきで表示する
  export [ノード]                      Markdown の箇条書きで出力する（ID なし）
  add <文字> --under <ノード> [--after <ノード>]
                                       子ノードを足す。--after で兄弟の後ろに入れる
  add <文字> --root                    新しい中心ノード（独立したマップ）を足す
  add <URL> --under <ノード>           リンクのノードを足す。文字はページの題名を読み込んで入れる
  add <文字> --url <URL> --under <ノード>
                                       文字を決めてリンクのノードを足す
  link <ノード> <URL>                  ノードにリンクを付ける・付け替える（文字はそのまま。空なら題名を入れる）
  unlink <ノード>                      リンクを外す
  rename <ノード> <文字>               名前を変える
  move <ノード> --under <ノード> [--after <ノード>]
                                       別の親の下へ移す（子ごと）
  move <ノード> --root                 枝を切り離して、独立したマップにする
  remove <ノード>                      ノードを子ごと消す
  collapse <ノード> / expand <ノード>  枝を折りたたむ / 開く
  layout <中心ノード> <both|right|left>
                                       マップの配置を両側・右だけ・左だけにする
  side <ノード> <left|right>           ノードを含む枝を中心の左か右へ出す（片側のマップは両側になる）
  import <ファイル|-> [--under <ノード> | --root] [--replace]
                                       Markdown の箇条書きを取り込む。「# 見出し」は中心ノードになる
                                       --replace はすべてのマップを作り直す
  new <題名>                           今のマップを中心ノード1つだけにして作り直す
  migrate [フォルダ] [--replace]       ファイル時代の <フォルダ>/<マップ名>.json と .current をサーバーへ移す
                                       （既定は data/）。同じ名前のマップは --replace のときだけ上書きする
  spaces                               開ける領域の一覧。* が自分の領域、ほかは共有されたもの（閲覧のみ）
  share [list]                         自分の領域を共有している相手
  share add <メール>                   自分の領域を、そのアカウントに読み取り専用で共有する
  share remove <メール>                共有をやめる

どのコマンドも --map <マップ名> で対象のマップを変えられる（省くと use で選んだもの）。
--space <領域ID> で、共有された領域を読める（maps・show・export だけ。省くと自分の領域）。
中心ノードは複数置ける。それぞれが独立したマップになる。
--under を省くと、中心ノードが1つのときはその下に入る。複数あるときは --under か --root が必要。
リンクは show で「リンク:URL」、export と import では「[文字](URL)」か URL だけの行になる。
ノードの指定: ID（n12）、完全一致の名前、または「中心/予算/人件費」のような経路（中心は省ける）。
名前が複数あるときは ID か経路で指定する。

環境変数（~/.config/mindmap/env に KEY=値 で書いてもよい。環境変数が優先）:
  MINDMAP_URL                  サーバー（既定は手元の開発サーバー http://127.0.0.1:4381）
  MINDMAP_TOKEN                API トークン（デプロイ先を使うとき）
  MINDMAP_MAP                  既定のマップ名（省くと use で選んだもの）";

fn main() -> ExitCode {
    match run(env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("エラー: {e}");
            ExitCode::FAILURE
        }
    }
}

type Res<T> = Result<T, String>;

/// 標準出力に書く。`| head` などで先に閉じられても落ちない。
fn out(s: &str) {
    let mut o = io::stdout().lock();
    let _ = o.write_all(s.as_bytes());
}
fn outln(s: &str) {
    out(&format!("{s}\n"));
}

// ---------- 設定 ----------

fn config_file() -> PathBuf {
    let home = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")).map(PathBuf::from).unwrap_or_default();
    home.join(".config").join("mindmap").join("env")
}

/// 環境変数、無ければ設定ファイル（KEY=値 の行。export と引用符は外す）の値。
fn setting(key: &str, file: &Path) -> String {
    if let Ok(v) = env::var(key) {
        if !v.is_empty() {
            return v;
        }
    }
    let Ok(text) = fs::read_to_string(file) else { return String::new() };
    for line in text.lines() {
        let line = line.trim();
        let line = line.strip_prefix("export ").map(str::trim_start).unwrap_or(line);
        let Some((k, v)) = line.split_once('=') else { continue };
        if k.trim() != key {
            continue;
        }
        let v = v.trim();
        for q in ['"', '\''] {
            if v.len() >= 2 && v.starts_with(q) && v.ends_with(q) {
                return v[1..v.len() - 1].to_string();
            }
        }
        return v.to_string();
    }
    String::new()
}

// ---------- 引数 ----------

#[derive(Default)]
struct Opts {
    under: Option<String>,
    after: Option<String>,
    map: Option<String>,
    space: Option<String>,
    url: Option<String>,
    replace: bool,
    root: bool,
    help: bool,
    version: bool,
}

fn parse_args(argv: Vec<String>) -> Res<(Vec<String>, Opts)> {
    let mut pos = Vec::new();
    let mut opt = Opts::default();
    let mut it = argv.into_iter();
    while let Some(a) = it.next() {
        let slot = match a.as_str() {
            "--under" => Some(&mut opt.under),
            "--after" => Some(&mut opt.after),
            "--map" => Some(&mut opt.map),
            "--space" => Some(&mut opt.space),
            "--url" => Some(&mut opt.url),
            _ => None,
        };
        if let Some(slot) = slot {
            *slot = Some(it.next().ok_or_else(|| format!("{a} のあとに値が必要です"))?);
            continue;
        }
        match a.as_str() {
            "--replace" => opt.replace = true,
            "--root" => opt.root = true,
            "--help" | "-h" => opt.help = true,
            "--version" | "-V" => opt.version = true,
            _ => pos.push(a),
        }
    }
    Ok((pos, opt))
}

fn need<'a>(v: Option<&'a String>, what: &str) -> Res<&'a str> {
    match v {
        Some(s) if !s.is_empty() => Ok(s),
        _ => Err(format!("{what} が必要です")),
    }
}

// ---------- API ----------

struct Api {
    base: String,
    token: String,
    file: PathBuf,
    space: String,
    agent: ureq::Agent,
}

impl Api {
    fn new(space: String) -> Api {
        let file = config_file();
        let base = setting("MINDMAP_URL", &file);
        let base = if base.is_empty() { DEFAULT_URL.to_string() } else { base.trim_end_matches('/').to_string() };
        let token = setting("MINDMAP_TOKEN", &file);
        let agent = ureq::AgentBuilder::new()
            .redirects(0)
            .timeout(Duration::from_secs(60))
            .user_agent(concat!("mindmap-cli/", env!("CARGO_PKG_VERSION")))
            .build();
        Api { base, token, file, space, agent }
    }

    /// ?name=（対象のマップ）と ?space=（選んだ領域）。ほかに足すものは extra で渡す。
    fn query<'a>(&'a self, name: Option<&'a str>, extra: &[(&'a str, &'a str)]) -> Vec<(&'a str, &'a str)> {
        let mut q = Vec::new();
        if let Some(n) = name {
            q.push(("name", n));
        }
        if !self.space.is_empty() {
            q.push(("space", self.space.as_str()));
        }
        q.extend_from_slice(extra);
        q
    }

    fn call(&self, method: &str, path: &str, query: &[(&str, &str)], body: Option<Value>) -> Res<Value> {
        let mut req = self.agent.request(method, &format!("{}{}", self.base, path)).set("Accept", "application/json");
        for (k, v) in query {
            req = req.query(k, v);
        }
        if !self.token.is_empty() {
            req = req.set("Authorization", &format!("Bearer {}", self.token));
        }
        let res = match body {
            Some(b) => req.set("Content-Type", "application/json").send_string(&b.to_string()),
            None => req.call(),
        };
        let (status, text) = match res {
            Ok(r) => (r.status(), r.into_string().unwrap_or_default()),
            Err(ureq::Error::Status(code, r)) => (code, r.into_string().unwrap_or_default()),
            Err(ureq::Error::Transport(_)) => {
                return Err(format!(
                    "サーバーに届きません: {}。開発サーバー（npm run dev）が動いているか、MINDMAP_URL を確かめてください",
                    self.base
                ))
            }
        };
        let data: Value = serde_json::from_str(&text).map_err(|_| {
            let head: String = text.chars().take(200).collect();
            format!("サーバーの応答が読めません（{status}）: {head}")
        })?;
        let error = data["error"].as_str().map(str::to_string);
        if status == 401 && self.token.is_empty() {
            return Err(format!("{}（{}）", error.unwrap_or_default(), self.file.display()));
        }
        if !(200..300).contains(&status) {
            return Err(error.unwrap_or_else(|| format!("サーバーがエラーを返しました（{status}）")));
        }
        Ok(data)
    }

    fn get(&self, path: &str, query: &[(&str, &str)]) -> Res<Value> {
        self.call("GET", path, query, None)
    }

    /// 名前・ID・経路で指した操作をサーバーで当て、その結果の一文を出す。
    fn op(&self, map: Option<&str>, op: &str, args: Map<String, Value>) -> Res<()> {
        let res = self.call("POST", "/api/op", &self.query(map, &[]), Some(json!({ "op": op, "args": args })))?;
        outln(res["message"].as_str().unwrap_or(""));
        Ok(())
    }
}

/// 値のある引数だけを詰める（無いものは送らない）。
fn args(pairs: &[(&str, Option<Value>)]) -> Map<String, Value> {
    pairs.iter().filter_map(|(k, v)| v.clone().map(|v| (k.to_string(), v))).collect()
}
fn s(v: Option<&String>) -> Option<Value> {
    v.map(|x| Value::String(x.clone()))
}
/// 必ず要る位置引数。無ければ「〇〇 が必要です」。
fn req(v: Option<&String>, what: &str) -> Res<Option<Value>> {
    Ok(Some(Value::String(need(v, what)?.to_string())))
}
fn flag(b: bool) -> Option<Value> {
    b.then_some(Value::Bool(true))
}

/// サーバーの時刻（ISO 8601）を手元の時刻の「年-月-日 時:分」にする。
fn local_time(iso: &str) -> String {
    DateTime::parse_from_rfc3339(iso)
        .map(|d| d.with_timezone(&Local).format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|_| iso.to_string())
}

fn str_of(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}

// ---------- コマンド ----------

fn run(argv: Vec<String>) -> Res<()> {
    let (pos, opt) = parse_args(argv)?;
    if opt.version {
        outln(concat!("mindmap ", env!("CARGO_PKG_VERSION")));
        return Ok(());
    }
    let Some(cmd) = pos.first().map(String::as_str) else {
        outln(USAGE);
        return Ok(());
    };
    if opt.help {
        outln(USAGE);
        return Ok(());
    }
    let space = opt.space.clone().unwrap_or_default();
    if !space.is_empty() && !matches!(cmd, "maps" | "show" | "export") {
        return Err("--space で開ける共有の領域は閲覧のみです。maps・show・export だけ使えます".into());
    }
    let api = Api::new(space);
    let p1 = pos.get(1);
    let p2 = pos.get(2);

    match cmd {
        "spaces" => {
            let res = api.get("/api/spaces", &[])?;
            let own = str_of(&res["own"]);
            for sp in res["spaces"].as_array().into_iter().flatten() {
                let mark = if str_of(&sp["id"]) == own { '*' } else { ' ' };
                let role = if str_of(&sp["role"]) == "owner" { "自分" } else { "閲覧のみ" };
                outln(&format!("{mark} {}\t{}\t{role}", str_of(&sp["id"]), str_of(&sp["owner"])));
            }
            return Ok(());
        }
        "share" => {
            let sub = p1.map(String::as_str).unwrap_or("list");
            let res = match sub {
                "list" => api.get("/api/shares", &[])?,
                "add" => api.call("POST", "/api/shares", &[], Some(json!({ "email": need(p2, "メールアドレス")? })))?,
                "remove" => api.call("DELETE", "/api/shares", &[], Some(json!({ "email": need(p2, "メールアドレス")? })))?,
                _ => return Err(format!("share のあとは list・add・remove のどれかです: {sub}")),
            };
            let shares = res["shares"].as_array().cloned().unwrap_or_default();
            if shares.is_empty() {
                outln(&format!("領域 {} は誰にも共有していません", str_of(&res["space"])));
            }
            for sh in &shares {
                let since: String = str_of(&sh["since"]).chars().take(10).collect();
                outln(&format!("{}\t{since} から", str_of(&sh["email"])));
            }
            return Ok(());
        }
        "maps" => {
            let res = api.get("/api/maps", &api.query(None, &[]))?;
            let maps = res["maps"].as_array().cloned().unwrap_or_default();
            if maps.is_empty() {
                outln("マップがありません。new <題名> --map <マップ名> で作るか、migrate で移してください");
                return Ok(());
            }
            let current = str_of(&res["current"]);
            for m in &maps {
                let mark = if str_of(&m["name"]) == current { '*' } else { ' ' };
                outln(&format!(
                    "{mark} {}\t{}\t中心 {} 件\t{}",
                    str_of(&m["name"]),
                    str_of(&m["title"]),
                    m["roots"],
                    local_time(str_of(&m["updatedAt"]))
                ));
            }
            return Ok(());
        }
        "use" => {
            let res = api.call("PUT", "/api/current", &[], Some(json!({ "name": need(p1, "マップ名")? })))?;
            outln(&format!("選択: {}（画面も切り替わります）", str_of(&res["name"])));
            return Ok(());
        }
        "migrate" => return migrate(&api, p1.map(String::as_str).unwrap_or("data"), opt.replace),
        _ => {}
    }

    // 対象のマップ名。--map、環境変数の順。どちらも無ければサーバーで今選んでいるもの。
    let env_map = env::var("MINDMAP_MAP").ok().filter(|v| !v.trim().is_empty());
    let map_name: Option<String> = opt.map.clone().or(env_map).map(|m| m.trim().to_string());
    let map = map_name.as_deref();

    match cmd {
        "new" => {
            let title = need(p1, "題名")?;
            // --map を省くと、今選んでいるマップを作り直す
            let name = match map {
                Some(m) => m.to_string(),
                None => api.get("/api/maps", &[])?["current"].as_str().unwrap_or("map").to_string(),
            };
            let replace = opt.replace || map.is_none();
            let res = api.call("POST", "/api/maps", &[], Some(json!({ "name": name, "title": title, "replace": replace })))?;
            let made = str_of(&res["name"]);
            let mut line = format!("マップ「{made}」を作りました: {} ({})", str_of(&res["root"]["text"]), str_of(&res["root"]["id"]));
            if str_of(&res["current"]) != made {
                line += &format!("。画面に出すには: mindmap use {made}");
            }
            outln(&line);
            Ok(())
        }
        "show" | "export" => {
            let mut extra: Vec<(&str, &str)> = Vec::new();
            if let Some(node) = p1 {
                extra.push(("node", node.as_str()));
            }
            if cmd == "show" {
                extra.push(("ids", "1"));
            }
            let res = api.get("/api/outline", &api.query(map, &extra)).map_err(|e| {
                if e == "not found" {
                    format!("サーバー（{}）に /api/outline がありません。サーバーを新しい版にデプロイしてください", api.base)
                } else {
                    e
                }
            })?;
            out(str_of(&res["text"]));
            Ok(())
        }
        "add" => {
            let text = if opt.url.is_some() { s(p1) } else { req(p1, "文字か URL")? };
            api.op(map, "add", args(&[
                ("text", text),
                ("url", s(opt.url.as_ref())),
                ("under", s(opt.under.as_ref())),
                ("after", s(opt.after.as_ref())),
                ("root", flag(opt.root)),
            ]))
        }
        "link" => api.op(map, "link", args(&[("node", req(p1, "ノード")?), ("url", req(p2, "URL")?)])),
        "unlink" => api.op(map, "unlink", args(&[("node", req(p1, "ノード")?)])),
        "rename" => api.op(map, "rename", args(&[("node", req(p1, "ノード")?), ("text", req(p2, "新しい文字")?)])),
        "move" => api.op(map, "move", args(&[
            ("node", req(p1, "ノード")?),
            ("under", s(opt.under.as_ref())),
            ("after", s(opt.after.as_ref())),
            ("root", flag(opt.root)),
        ])),
        "remove" | "collapse" | "expand" => api.op(map, cmd, args(&[("node", req(p1, "ノード")?)])),
        "layout" => api.op(map, "layout", args(&[("node", req(p1, "中心ノード")?), ("mode", req(p2, "配置（both / right / left）")?)])),
        "side" => api.op(map, "side", args(&[("node", req(p1, "ノード")?), ("side", req(p2, "向き（left / right）")?)])),
        "import" => {
            let src = need(p1, "ファイル")?;
            let text = if src == "-" {
                let mut buf = String::new();
                io::stdin().read_to_string(&mut buf).map_err(|e| format!("標準入力が読めません: {e}"))?;
                buf
            } else {
                fs::read_to_string(src).map_err(|e| format!("{src} が読めません: {e}"))?
            };
            api.op(map, "import", args(&[
                ("text", Some(Value::String(text))),
                ("under", s(opt.under.as_ref())),
                ("root", flag(opt.root)),
                ("replace", flag(opt.replace)),
            ]))
        }
        _ => Err(format!("知らないコマンドです: {cmd}\n\n{USAGE}")),
    }
}

/// ファイル時代の <フォルダ>/<マップ名>.json と .current をサーバーへ移す。形の確かめと直しはサーバーが行う。
fn migrate(api: &Api, dir: &str, replace: bool) -> Res<()> {
    let dir = fs::canonicalize(dir).map_err(|e| format!("{dir} が開けません: {e}"))?;
    let mut maps = Map::new();
    let mut entries: Vec<_> = fs::read_dir(&dir).map_err(|e| format!("{} が読めません: {e}", dir.display()))?.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let f = e.file_name().to_string_lossy().to_string();
        if !f.ends_with(".json") || f.starts_with('.') {
            continue;
        }
        let text = fs::read_to_string(e.path()).map_err(|err| format!("{f} が読めません: {err}"))?;
        let m: Value = serde_json::from_str(&text).map_err(|_| format!("{f} はマップとして読めません"))?;
        maps.insert(f, m);
    }
    if maps.is_empty() {
        return Err(format!("{} にマップ（*.json）がありません", dir.display()));
    }
    let current = fs::read_to_string(dir.join(".current")).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let mut body = json!({ "maps": maps, "replace": replace });
    if let Some(c) = current {
        body["current"] = Value::String(c);
    }
    let res = api.call("POST", "/api/import", &[], Some(body))?;
    let list = |k: &str| res[k].as_array().map(|a| a.iter().map(str_of).collect::<Vec<_>>().join(", ")).unwrap_or_default();
    if !list("added").is_empty() {
        outln(&format!("追加: {}", list("added")));
    }
    if !list("replaced").is_empty() {
        outln(&format!("上書き: {}", list("replaced")));
    }
    if !list("skipped").is_empty() {
        outln(&format!("スキップ（もうある）: {}。上書きするなら --replace を付けてください", list("skipped")));
    }
    outln(&format!("選択: {}", str_of(&res["current"])));
    Ok(())
}
