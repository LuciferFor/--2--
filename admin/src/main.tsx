import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type ApiEnvelope<T> =
  | { success: true; data: T; error: null; meta: Record<string, unknown> }
  | { success: false; data: null; error: { code: string; message: string }; meta: Record<string, unknown> };

type Tab =
  | "overview"
  | "tester"
  | "bungieTester"
  | "metrics"
  | "queries"
  | "players"
  | "qqBindings"
  | "manifest"
  | "config"
  | "audit";

interface Overview {
  service: { status: string; uptimeSeconds: number; nodeEnv: string };
  dependencies: { redis: string; postgres: string };
  manifest: ManifestStatus;
  admin: { username: string };
}

interface ManifestStatus {
  versions: Array<{ locale: string; version: string; updatedAt: string; definitionCount: number }>;
}

interface Metrics {
  totalRequests: number;
  cacheHits: number;
  cacheHitRate: number;
  topRoutes: Array<{ route: string; total: number }>;
  points: Array<{ bucket: string; total: number; cacheHits: number }>;
}

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

interface QueryLog {
  id: number;
  route: string;
  cacheHit: boolean;
  ipHash?: string;
  createdAt: string;
}

interface PlayerRow {
  id: number;
  bungieName: string;
  displayName: string;
  displayNameCode: number;
  membershipType: number;
  membershipId: string;
  lastSeenAt: string;
}

interface AuditRow {
  id: number;
  actor: string;
  action: string;
  target?: string;
  createdAt: string;
}

interface QqBindingRow {
  id: number;
  qq: string;
  membershipType: number;
  membershipId: string;
  bungieName?: string;
  displayName?: string;
  displayNameCode?: number;
  notes?: string;
  lastResolvedAt?: string;
  updatedAt: string;
  oauth?: {
    authorized: boolean;
    bungieMembershipId?: string;
    accessExpiresAt?: string;
    refreshExpiresAt?: string;
    revokedAt?: string;
    updatedAt?: string;
  };
}

interface QueryParam {
  id: number;
  key: string;
  value: string;
}

interface QueryPreset {
  label: string;
  path: string;
  query: Record<string, string>;
}

interface BungiePreset {
  label: string;
  method: "GET" | "POST";
  path: string;
  query: Record<string, string>;
  body: string;
}

type AdminD2QueryResult =
  | {
      kind: "json";
      method: string;
      url: string;
      statusCode: number;
      contentType: string;
      body: unknown;
      tookMs: number;
    }
  | {
      kind: "image";
      method: string;
      url: string;
      statusCode: number;
      contentType: string;
      bytes: number;
      base64: string;
      tookMs: number;
    };

interface AdminBungieQueryResult {
  kind: "bungie";
  method: string;
  path: string;
  statusCode: number;
  statusText: string;
  contentType: string;
  headers: Record<string, string>;
  body: unknown;
  tookMs: number;
}

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "总览" },
  { id: "tester", label: "接口测试" },
  { id: "bungieTester", label: "Bungie API" },
  { id: "metrics", label: "指标" },
  { id: "queries", label: "查询日志" },
  { id: "players", label: "玩家缓存" },
  { id: "qqBindings", label: "QQ绑定" },
  { id: "manifest", label: "Manifest" },
  { id: "config", label: "配置" },
  { id: "audit", label: "审计" }
];

const queryPresets: QueryPreset[] = [
  { label: "搜索玩家", path: "/api/d2/search", query: { bungieName: "Guardian#0007" } },
  { label: "账号 Profile", path: "/api/d2/profile/3/4611686018", query: {} },
  { label: "总览战绩", path: "/api/d2/summary/3/4611686018", query: { mode: "all" } },
  { label: "生涯总览", path: "/api/d2/career/3/4611686018", query: {} },
  { label: "PVP 详情", path: "/api/d2/pvp/3/4611686018", query: { count: "50" } },
  { label: "突袭总览", path: "/api/d2/raids/3/4611686018", query: { historyPages: "1", pgcrLimit: "20" } },
  { label: "地牢总览", path: "/api/d2/dungeons/3/4611686018", query: { historyPages: "10", pgcrLimit: "100" } },
  { label: "宗师查询", path: "/api/d2/grandmasters/3/4611686018", query: { historyPages: "10", pgcrLimit: "50", season: "current" } },
  { label: "最近活动", path: "/api/d2/activities/3/4611686018", query: { mode: "raid", count: "10", page: "0" } },
  { label: "活跃热力图", path: "/api/d2/heatmap/3/4611686018", query: { mode: "all", range: "all", timezone: "Asia/Shanghai" } },
  { label: "名片资料", path: "/api/d2/namecard/3/4611686018", query: {} },
  { label: "PGCR 单局", path: "/api/d2/pgcr/123", query: {} },
  { label: "武器统计", path: "/api/d2/weapons/3/4611686018", query: {} },
  { label: "锻造查询", path: "/api/d2/craftables/3/4611686018", query: {} },
  { label: "催化查询(OAuth)", path: "/api/d2/catalysts/qq/607972716", query: {} },
  { label: "单武器催化", path: "/api/d2/catalysts/qq/607972716/item", query: { q: "虫狙" } },
  { label: "催化效果", path: "/api/d2/catalyst-info", query: { q: "挽歌" } },
  { label: "武器资料", path: "/api/d2/item-info", query: { q: "极高反射", limit: "6" } },
  { label: "Perk反查", path: "/api/d2/perk-weapons", query: { perks: "爆破专家,斩首武器", weaponType: "冲锋枪", limit: "50" } },
  { label: "仓库搜索(OAuth)", path: "/api/d2/vault/3/4611686018/search", query: { q: "fatebringer" } },
  { label: "总览卡片", path: "/api/d2/cards/summary.png", query: { bungieName: "Guardian#0007", mode: "raid" } },
  { label: "Profile 卡片", path: "/api/d2/cards/profile.png", query: { bungieName: "Guardian#0007" } },
  { label: "武器卡片", path: "/api/d2/cards/weapons.png", query: { bungieName: "Guardian#0007" } },
  { label: "突袭总览卡片", path: "/api/d2/cards/raids.png", query: { bungieName: "Guardian#0007", historyPages: "1", pgcrLimit: "20" } },
  { label: "最近活动卡片", path: "/api/d2/cards/latest-activity.png", query: { bungieName: "Guardian#0007", mode: "raid" } },
  { label: "单局卡片", path: "/api/d2/cards/activity.png", query: { activityId: "123" } }
];

const bungiePresets: BungiePreset[] = [
  { label: "Manifest", method: "GET", path: "/Destiny2/Manifest/", query: {}, body: "" },
  { label: "历史统计定义", method: "GET", path: "/Destiny2/Stats/Definition/", query: {}, body: "" },
  {
    label: "搜索玩家",
    method: "POST",
    path: "/Destiny2/SearchDestinyPlayerByBungieName/-1/",
    query: {},
    body: JSON.stringify({ displayName: "Guardian", displayNameCode: 7 }, null, 2)
  },
  {
    label: "Profile",
    method: "GET",
    path: "/Destiny2/3/Profile/4611686018/",
    query: { components: "100,200" },
    body: ""
  },
  {
    label: "角色活动",
    method: "GET",
    path: "/Destiny2/3/Account/4611686018/Character/2305843009/Stats/Activities/",
    query: { count: "10", page: "0" },
    body: ""
  },
  {
    label: "PGCR",
    method: "GET",
    path: "/Destiny2/Stats/PostGameCarnageReport/123/",
    query: {},
    body: ""
  },
  {
    label: "里程碑",
    method: "GET",
    path: "/Destiny2/Milestones/",
    query: {},
    body: ""
  }
];

function App() {
  const [me, setMe] = useState<{ username: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    api<{ username: string }>("/api/admin/auth/me")
      .then(setMe)
      .catch(() => undefined)
      .finally(() => setAuthChecked(true));
  }, []);

  if (!authChecked) {
    return <Shell status="正在检查登录状态" />;
  }

  if (!me) {
    return <Login onLogin={setMe} />;
  }

  return <Dashboard username={me.username} onLogout={() => setMe(null)} />;
}

function Login({ onLogin }: { onLogin: (value: { username: string }) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      onLogin(await api<{ username: string }>("/api/admin/auth/login", { method: "POST", body: { username, password } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Shell status="命运2战绩后台">
      <form className="login" onSubmit={submit}>
        <h1>管理后台</h1>
        <label>
          账号
          <input value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label>
          密码
          <input value={password} type="password" onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={loading}>{loading ? "登录中" : "登录"}</button>
      </form>
    </Shell>
  );
}

function Dashboard({ username, onLogout }: { username: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");

  async function logout() {
    await api("/api/admin/auth/logout", { method: "POST" }).catch(() => undefined);
    onLogout();
  }

  return (
    <Shell status={`管理员 ${username}`} action={<button onClick={logout}>退出</button>}>
      <nav className="tabs">
        {tabs.map((item) => (
          <button className={tab === item.id ? "active" : ""} key={item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      {tab === "overview" && <OverviewPanel />}
      {tab === "tester" && <TesterPanel />}
      {tab === "bungieTester" && <BungieTesterPanel />}
      {tab === "metrics" && <MetricsPanel />}
      {tab === "queries" && <QueriesPanel />}
      {tab === "players" && <PlayersPanel />}
      {tab === "qqBindings" && <QqBindingsPanel />}
      {tab === "manifest" && <ManifestPanel />}
      {tab === "config" && <ConfigPanel />}
      {tab === "audit" && <AuditPanel />}
    </Shell>
  );
}

function TesterPanel() {
  const [path, setPath] = useState(queryPresets[0].path);
  const [params, setParams] = useState<QueryParam[]>(queryToRows(queryPresets[0].query));
  const [result, setResult] = useState<AdminD2QueryResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function applyPreset(indexText: string) {
    const preset = queryPresets[Number(indexText)];
    if (!preset) return;
    setPath(preset.path);
    setParams(queryToRows(preset.query));
    setResult(null);
    setError("");
  }

  function updateParam(id: number, field: "key" | "value", value: string) {
    setParams((items) => items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  }

  function removeParam(id: number) {
    setParams((items) => (items.length > 1 ? items.filter((item) => item.id !== id) : [{ id: Date.now(), key: "", value: "" }]));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await api<AdminD2QueryResult>("/api/admin/d2/query", {
          method: "POST",
          body: {
            method: "GET",
            path,
            query: rowsToQuery(params)
          }
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="stack">
      <form className="panel tester" onSubmit={submit}>
        <div className="form-row">
          <label>
            预设
            <select onChange={(event) => applyPreset(event.target.value)} defaultValue="0">
              {queryPresets.map((preset, index) => (
                <option key={preset.label} value={index}>{preset.label}</option>
              ))}
            </select>
          </label>
          <label>
            方法
            <input value="GET" disabled />
          </label>
        </div>
        <label>
          路径
          <input value={path} onChange={(event) => setPath(event.target.value)} />
        </label>
        <div className="query-editor">
          <div className="query-editor-head">
            <span>Query 参数</span>
            <button type="button" onClick={() => setParams((items) => [...items, { id: Date.now(), key: "", value: "" }])}>添加参数</button>
          </div>
          {params.map((param) => (
            <div className="query-row" key={param.id}>
              <input placeholder="key" value={param.key} onChange={(event) => updateParam(param.id, "key", event.target.value)} />
              <input placeholder="value" value={param.value} onChange={(event) => updateParam(param.id, "value", event.target.value)} />
              <button type="button" onClick={() => removeParam(param.id)}>删除</button>
            </div>
          ))}
        </div>
        {error && <div className="error">{error}</div>}
        <div className="toolbar">
          <button disabled={loading}>{loading ? "请求中" : "发送请求"}</button>
        </div>
      </form>
      {result && <QueryResultPanel result={result} />}
    </section>
  );
}

function QueryResultPanel({ result }: { result: AdminD2QueryResult }) {
  return (
    <div className="panel result-panel">
      <div className="result-meta">
        <span>{result.method}</span>
        <span>{result.statusCode}</span>
        <span>{result.tookMs}ms</span>
        <span>{result.contentType || "-"}</span>
      </div>
      <div className="result-url">{result.url}</div>
      {result.kind === "image" ? (
        <div className="image-result">
          <img src={`data:${result.contentType};base64,${result.base64}`} alt="接口图片结果" />
          <div>{result.bytes} bytes</div>
        </div>
      ) : (
        <pre>{JSON.stringify(result.body, null, 2)}</pre>
      )}
    </div>
  );
}

function BungieTesterPanel() {
  const [method, setMethod] = useState<"GET" | "POST" | "PUT" | "PATCH" | "DELETE">(bungiePresets[0].method);
  const [path, setPath] = useState(bungiePresets[0].path);
  const [params, setParams] = useState<QueryParam[]>(queryToRows(bungiePresets[0].query));
  const [body, setBody] = useState(bungiePresets[0].body);
  const [oauthAccessToken, setOauthAccessToken] = useState("");
  const [result, setResult] = useState<AdminBungieQueryResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function applyPreset(indexText: string) {
    const preset = bungiePresets[Number(indexText)];
    if (!preset) return;
    setMethod(preset.method);
    setPath(preset.path);
    setParams(queryToRows(preset.query));
    setBody(preset.body);
    setResult(null);
    setError("");
  }

  function updateParam(id: number, field: "key" | "value", value: string) {
    setParams((items) => items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  }

  function removeParam(id: number) {
    setParams((items) => (items.length > 1 ? items.filter((item) => item.id !== id) : [{ id: Date.now(), key: "", value: "" }]));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const trimmedBody = body.trim();
      const requestBody =
        method === "GET" || method === "DELETE" || trimmedBody.length === 0 ? undefined : JSON.parse(trimmedBody);
      setResult(
        await api<AdminBungieQueryResult>("/api/admin/bungie/query", {
          method: "POST",
          body: {
            method,
            path,
            query: rowsToQuery(params),
            ...(requestBody === undefined ? {} : { body: requestBody }),
            ...(oauthAccessToken.trim().length === 0 ? {} : { oauthAccessToken: oauthAccessToken.trim() })
          }
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="stack">
      <form className="panel tester" onSubmit={submit}>
        <div className="form-row">
          <label>
            预设
            <select onChange={(event) => applyPreset(event.target.value)} defaultValue="0">
              {bungiePresets.map((preset, index) => (
                <option key={preset.label} value={index}>{preset.label}</option>
              ))}
            </select>
          </label>
          <label>
            方法
            <select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
          </label>
        </div>
        <label>
          Bungie Platform 路径
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/Destiny2/Manifest/" />
        </label>
        <div className="query-editor">
          <div className="query-editor-head">
            <span>Query 参数</span>
            <button type="button" onClick={() => setParams((items) => [...items, { id: Date.now(), key: "", value: "" }])}>添加参数</button>
          </div>
          {params.map((param) => (
            <div className="query-row" key={param.id}>
              <input placeholder="key" value={param.key} onChange={(event) => updateParam(param.id, "key", event.target.value)} />
              <input placeholder="value" value={param.value} onChange={(event) => updateParam(param.id, "value", event.target.value)} />
              <button type="button" onClick={() => removeParam(param.id)}>删除</button>
            </div>
          ))}
        </div>
        <label>
          Body JSON
          <textarea
            disabled={method === "GET" || method === "DELETE"}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="{ }"
          />
        </label>
        <label>
          OAuth Access Token
          <input
            type="password"
            value={oauthAccessToken}
            onChange={(event) => setOauthAccessToken(event.target.value)}
            placeholder="需要私密接口时填写，可留空"
          />
        </label>
        {error && <div className="error">{error}</div>}
        <div className="toolbar">
          <button disabled={loading}>{loading ? "请求中" : "发送 Bungie 请求"}</button>
        </div>
      </form>
      {result && <BungieResultPanel result={result} />}
    </section>
  );
}

function BungieResultPanel({ result }: { result: AdminBungieQueryResult }) {
  return (
    <div className="panel result-panel">
      <div className="result-meta">
        <span>{result.method}</span>
        <span>{result.statusCode}</span>
        <span>{result.tookMs}ms</span>
        <span>{result.contentType || "-"}</span>
      </div>
      <div className="result-url">{result.path}</div>
      <pre>{JSON.stringify(result.body, null, 2)}</pre>
    </div>
  );
}

function OverviewPanel() {
  const { data, error, reload } = useLoader<Overview>("/api/admin/overview");
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading />;

  return (
    <section className="grid">
      <Metric label="服务" value={data.service.status} tone="green" />
      <Metric label="运行环境" value={data.service.nodeEnv} />
      <Metric label="Redis" value={data.dependencies.redis} tone={data.dependencies.redis === "ok" ? "green" : "red"} />
      <Metric label="Postgres" value={data.dependencies.postgres} tone={data.dependencies.postgres === "ok" ? "green" : "red"} />
      <Metric label="运行时长" value={formatUptime(data.service.uptimeSeconds)} />
      <Metric label="Manifest" value={data.manifest.versions[0]?.version ?? "未加载"} />
    </section>
  );
}

function MetricsPanel() {
  const { data, error, reload } = useLoader<Metrics>("/api/admin/metrics?interval=hour");
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const max = Math.max(1, ...data.points.map((point) => point.total));
  return (
    <section className="stack">
      <div className="grid">
        <Metric label="请求总数" value={data.totalRequests} />
        <Metric label="缓存命中" value={data.cacheHits} tone="green" />
        <Metric label="命中率" value={`${data.cacheHitRate}%`} />
      </div>
      <div className="panel">
        <h2>请求趋势</h2>
        <div className="bars">
          {data.points.slice(-24).map((point) => (
            <div key={point.bucket} className="bar-wrap" title={`${formatDate(point.bucket)} ${point.total}`}>
              <div className="bar" style={{ height: `${Math.max(6, (point.total / max) * 110)}px` }} />
            </div>
          ))}
        </div>
      </div>
      <SimpleTable
        columns={["接口", "次数"]}
        rows={data.topRoutes.map((route) => [route.route, route.total])}
        empty="暂无接口统计"
      />
    </section>
  );
}

function QueriesPanel() {
  const { data, error, reload } = useLoader<Paginated<QueryLog>>("/api/admin/queries?pageSize=50");
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <SimpleTable
      columns={["时间", "接口", "缓存", "IP Hash"]}
      rows={data.items.map((row) => [formatDate(row.createdAt), row.route, row.cacheHit ? "命中" : "未命中", row.ipHash?.slice(0, 12) ?? "-"])}
      empty="暂无查询日志"
    />
  );
}

function PlayersPanel() {
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("/api/admin/players?pageSize=50");
  const { data, error, reload } = useLoader<Paginated<PlayerRow>>(url);

  function search(event: React.FormEvent) {
    event.preventDefault();
    setUrl(`/api/admin/players?pageSize=50&q=${encodeURIComponent(q)}`);
  }

  async function refresh(player: PlayerRow) {
    await api(`/api/admin/players/${player.membershipType}/${player.membershipId}/refresh`, { method: "POST" });
    reload();
  }

  return (
    <section className="stack">
      <form className="toolbar" onSubmit={search}>
        <input placeholder="BungieName 或 membershipId" value={q} onChange={(event) => setQ(event.target.value)} />
        <button>搜索</button>
      </form>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data ? (
        <Loading />
      ) : (
        <table>
          <thead>
            <tr>
              <th>玩家</th>
              <th>Membership</th>
              <th>最近查询</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((player) => (
              <tr key={`${player.membershipType}:${player.membershipId}`}>
                <td>{player.bungieName}</td>
                <td>{`${player.membershipType}:${player.membershipId}`}</td>
                <td>{formatDate(player.lastSeenAt)}</td>
                <td><button onClick={() => refresh(player)}>刷新</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function QqBindingsPanel() {
  const [q, setQ] = useState("");
  const [url, setUrl] = useState("/api/admin/bindings/qq?pageSize=50");
  const [mode, setMode] = useState<"bungieName" | "membership">("bungieName");
  const [qq, setQq] = useState("");
  const [bungieName, setBungieName] = useState("");
  const [membershipType, setMembershipType] = useState("3");
  const [membershipId, setMembershipId] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState<QqBindingRow | null>(null);
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useLoader<Paginated<QqBindingRow>>(url);

  function search(event: React.FormEvent) {
    event.preventDefault();
    setUrl(`/api/admin/bindings/qq?pageSize=50&q=${encodeURIComponent(q)}`);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaved(null);
    setFormError("");
    try {
      const body =
        mode === "bungieName"
          ? { qq, bungieName, notes }
          : { qq, membershipType: Number(membershipType), membershipId, notes };
      const result = await api<QqBindingRow>("/api/admin/bindings/qq", { method: "POST", body });
      setSaved(result);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteBinding(binding: QqBindingRow) {
    if (!window.confirm(`删除 QQ ${binding.qq} 的绑定？`)) return;
    await api(`/api/admin/bindings/qq/${binding.qq}`, { method: "DELETE" });
    reload();
  }

  async function revokeOAuth(binding: QqBindingRow) {
    if (!window.confirm(`撤销 QQ ${binding.qq} 的 Bungie OAuth 授权？绑定关系会保留。`)) return;
    await api(`/api/admin/bindings/qq/${binding.qq}/oauth`, { method: "DELETE" });
    reload();
  }

  async function copyMembership(binding: QqBindingRow) {
    await navigator.clipboard.writeText(`${binding.membershipType}:${binding.membershipId}`).catch(() => undefined);
  }

  return (
    <section className="stack">
      <form className="panel binding-form" onSubmit={submit}>
        <div className="form-row three">
          <label>
            QQ
            <input value={qq} onChange={(event) => setQq(event.target.value)} placeholder="123456" />
          </label>
          <label>
            绑定方式
            <select value={mode} onChange={(event) => setMode(event.target.value as "bungieName" | "membership")}>
              <option value="bungieName">BungieName</option>
              <option value="membership">Membership</option>
            </select>
          </label>
          <label>
            备注
            <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="可选" />
          </label>
        </div>
        {mode === "bungieName" ? (
          <label>
            BungieName
            <input value={bungieName} onChange={(event) => setBungieName(event.target.value)} placeholder="Name#1234" />
          </label>
        ) : (
          <div className="form-row">
            <label>
              MembershipType
              <input value={membershipType} onChange={(event) => setMembershipType(event.target.value)} />
            </label>
            <label>
              MembershipId
              <input value={membershipId} onChange={(event) => setMembershipId(event.target.value)} placeholder="461168..." />
            </label>
          </div>
        )}
        {formError && <div className="error">{formError}</div>}
        {saved && <div className="success">{`已保存 ${saved.qq} -> ${saved.membershipType}:${saved.membershipId}`}</div>}
        <div className="toolbar">
          <button disabled={busy}>{busy ? "保存中" : "保存/覆盖绑定"}</button>
        </div>
      </form>
      <form className="toolbar" onSubmit={search}>
        <input placeholder="QQ、BungieName 或 membershipId" value={q} onChange={(event) => setQ(event.target.value)} />
        <button>搜索</button>
      </form>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data ? (
        <Loading />
      ) : (
        <table>
          <thead>
            <tr>
              <th>QQ</th>
              <th>玩家</th>
              <th>Membership</th>
              <th>备注</th>
              <th>OAuth</th>
              <th>最近解析</th>
              <th>更新</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr><td colSpan={8}>暂无 QQ 绑定</td></tr>
            ) : data.items.map((binding) => (
              <tr key={binding.qq}>
                <td>{binding.qq}</td>
                <td>{binding.bungieName ?? binding.displayName ?? "-"}</td>
                <td>{`${binding.membershipType}:${binding.membershipId}`}</td>
                <td>{binding.notes ?? "-"}</td>
                <td>{formatOAuthStatus(binding.oauth)}</td>
                <td>{binding.lastResolvedAt ? formatDate(binding.lastResolvedAt) : "-"}</td>
                <td>{formatDate(binding.updatedAt)}</td>
                <td className="actions">
                  <button onClick={() => copyMembership(binding)}>复制ID</button>
                  <button onClick={() => revokeOAuth(binding)} disabled={!binding.oauth?.authorized}>撤销授权</button>
                  <button onClick={() => deleteBinding(binding)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ManifestPanel() {
  const { data, error, reload } = useLoader<Overview>("/api/admin/overview");
  const [busy, setBusy] = useState(false);

  async function refreshManifest() {
    setBusy(true);
    await api("/api/admin/manifest/refresh", { method: "POST" }).finally(() => setBusy(false));
    reload();
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <section className="stack">
      <div className="toolbar"><button onClick={refreshManifest} disabled={busy}>{busy ? "刷新中" : "刷新 Manifest"}</button></div>
      <SimpleTable
        columns={["语言", "版本", "定义数量", "更新时间"]}
        rows={data.manifest.versions.map((row) => [row.locale, row.version, row.definitionCount, formatDate(row.updatedAt)])}
        empty="暂无 Manifest 信息"
      />
    </section>
  );
}

function ConfigPanel() {
  const { data, error, reload } = useLoader<Record<string, unknown>>("/api/admin/config");
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <SimpleTable
      columns={["配置", "值"]}
      rows={Object.entries(data).map(([key, value]) => [key, String(value)])}
      empty="暂无配置"
    />
  );
}

function AuditPanel() {
  const { data, error, reload } = useLoader<Paginated<AuditRow>>("/api/admin/audit?pageSize=50");
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <SimpleTable
      columns={["时间", "管理员", "操作", "目标"]}
      rows={data.items.map((row) => [formatDate(row.createdAt), row.actor, row.action, row.target ?? "-"])}
      empty="暂无审计日志"
    />
  );
}

function Shell({ children, status, action }: { children?: React.ReactNode; status: string; action?: React.ReactNode }) {
  return (
    <main>
      <header>
        <div>
          <div className="brand">命运2战绩后台</div>
          <div className="status">{status}</div>
        </div>
        {action}
      </header>
      {children}
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "green" | "red" }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className={tone ? `metric-value ${tone}` : "metric-value"}>{value}</div>
    </div>
  );
}

function SimpleTable({ columns, rows, empty }: { columns: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <table>
      <thead>
        <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={columns.length}>{empty}</td></tr>
        ) : rows.map((row, index) => (
          <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function Loading() {
  return <div className="panel">加载中</div>;
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="error-row"><span>{message}</span><button onClick={onRetry}>重试</button></div>;
}

function useLoader<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const reload = () => setTick((value) => value + 1);
  const memoUrl = useMemo(() => url, [url]);

  useEffect(() => {
    let alive = true;
    setError("");
    api<T>(memoUrl)
      .then((value) => alive && setData(value))
      .catch((err) => alive && setError(err instanceof Error ? err.message : "请求失败"));
    return () => {
      alive = false;
    };
  }, [memoUrl, tick]);

  return { data, error, reload };
}

async function api<T>(url: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || !envelope.success) {
    throw new Error(envelope.success ? response.statusText : envelope.error.message);
  }
  return envelope.data;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatOAuthStatus(oauth: QqBindingRow["oauth"]) {
  if (!oauth || !oauth.authorized) {
    return oauth?.revokedAt ? `已撤销 ${formatDate(oauth.revokedAt)}` : "未授权";
  }
  const refresh = oauth.refreshExpiresAt ? `刷新至 ${formatDate(oauth.refreshExpiresAt)}` : "无刷新Token";
  return `已授权 / ${refresh}`;
}

function formatUptime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function queryToRows(query: Record<string, string>): QueryParam[] {
  const rows = Object.entries(query).map(([key, value], index) => ({ id: Date.now() + index, key, value }));
  return rows.length > 0 ? rows : [{ id: Date.now(), key: "", value: "" }];
}

function rowsToQuery(rows: QueryParam[]): Record<string, string> {
  return Object.fromEntries(
    rows
      .map((row) => [row.key.trim(), row.value] as const)
      .filter(([key]) => key.length > 0)
  );
}

createRoot(document.getElementById("root")!).render(<App />);
