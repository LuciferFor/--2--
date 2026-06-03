import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type ApiEnvelope<T> =
  | { success: true; data: T; error: null; meta: Record<string, unknown> }
  | { success: false; data: null; error: { code: string; message: string }; meta: Record<string, unknown> };

type Tab = "overview" | "metrics" | "queries" | "players" | "manifest" | "config" | "audit";

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

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "overview", label: "总览" },
  { id: "metrics", label: "指标" },
  { id: "queries", label: "查询日志" },
  { id: "players", label: "玩家缓存" },
  { id: "manifest", label: "Manifest" },
  { id: "config", label: "配置" },
  { id: "audit", label: "审计" }
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
      {tab === "metrics" && <MetricsPanel />}
      {tab === "queries" && <QueriesPanel />}
      {tab === "players" && <PlayersPanel />}
      {tab === "manifest" && <ManifestPanel />}
      {tab === "config" && <ConfigPanel />}
      {tab === "audit" && <AuditPanel />}
    </Shell>
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

function formatUptime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

createRoot(document.getElementById("root")!).render(<App />);
