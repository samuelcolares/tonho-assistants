import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GitBranch, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  addGitProject,
  clearGithubToken,
  getGitStats,
  getGithubTokenStatus,
  listGitProjects,
  pickFolder,
  refreshGitStats,
  removeGitProject,
  saveGithubToken,
  updateGitProject,
} from "@/api";
import type {
  GitProject,
  GitProjectStats,
  GitStatsRange,
  GithubTokenStatus,
  RangePreset,
} from "@/types";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function rangeFromPreset(preset: RangePreset, since?: string, until?: string): GitStatsRange {
  if (preset === "custom") {
    return {
      since: since ? new Date(since).toISOString() : isoDaysAgo(30),
      until: until ? new Date(until).toISOString() : new Date().toISOString(),
    };
  }
  return { since: isoDaysAgo(Number(preset)), until: new Date().toISOString() };
}

function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

export function RepoStatsView() {
  const { toast } = useToast();
  const [projects, setProjects] = useState<GitProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<GitProject | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GitProject | null>(null);

  useEffect(() => {
    listGitProjects().then(setProjects);
  }, []);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  const handleAdd = async () => {
    const folder = await pickFolder();
    if (!folder) return;
    setAdding(true);
    try {
      const project = await addGitProject(folder);
      setProjects((prev) => [...prev, project]);
      setSelectedId(project.id);
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível adicionar", description: String(e) });
    } finally {
      setAdding(false);
    }
  };

  const handleSaveEdit = async (updated: GitProject) => {
    const saved = await updateGitProject(updated);
    setProjects((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
    setEditing(null);
  };

  const handleRemove = async (id: string) => {
    await removeGitProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  if (selected) {
    return (
      <RepoDetailView
        project={selected}
        onBack={() => setSelectedId(null)}
        onEdit={() => setEditing(selected)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <p className="max-w-xl text-[13px] leading-relaxed text-ink-muted">
          Escolha uma pasta que seja um repositório git pra ver estatísticas de commits, linhas
          alteradas e comparação com outros contribuintes.
        </p>
        <Button onClick={handleAdd} disabled={adding}>
          <Plus className="h-4 w-4" /> {adding ? "Verificando…" : "Adicionar pasta"}
        </Button>
      </div>

      {projects.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <p className="text-sm font-semibold text-ink">Nenhum repositório adicionado ainda</p>
          <p className="max-w-xs text-sm text-ink-muted">
            Adicione uma pasta local que seja um projeto git pra começar a ver as estatísticas.
          </p>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {projects.map((project) => (
          <Card
            key={project.id}
            className="flex cursor-pointer flex-col gap-2 hover:border-border-strong"
            onClick={() => setSelectedId(project.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 truncate text-sm font-semibold text-bonnie">
                <GitBranch className="h-4 w-4 shrink-0" />
                {project.name}
              </span>
              <div className="flex shrink-0 gap-0.5" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" onClick={() => setEditing(project)}>
                  ✎
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hover:bg-danger-subtle hover:text-danger"
                  onClick={() => setDeleteTarget(project)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <p className="truncate font-mono text-[12px] text-ink-faint">{project.localPath}</p>
            {project.githubOwner && project.githubRepo ? (
              <Badge variant="bonnie" className="w-fit">
                <GitBranch className="mr-1 h-3 w-3" />
                {project.githubOwner}/{project.githubRepo}
              </Badge>
            ) : (
              <span className="text-[11px] text-ink-faint">Sem remote do GitHub</span>
            )}
          </Card>
        ))}
      </div>

      {editing && (
        <ProjectEditDialog
          project={editing}
          open={!!editing}
          onOpenChange={(open) => !open && setEditing(null)}
          onSave={handleSaveEdit}
        />
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover "{deleteTarget?.name}"?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-muted">
            O projeto deixa de aparecer aqui. Os arquivos do repositório não são afetados.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) handleRemove(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Remover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProjectEditDialog({
  project,
  open,
  onOpenChange,
  onSave,
}: {
  project: GitProject;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updated: GitProject) => void;
}) {
  const [name, setName] = useState(project.name);
  const [githubOwner, setGithubOwner] = useState(project.githubOwner ?? "");
  const [githubRepo, setGithubRepo] = useState(project.githubRepo ?? "");
  const [emails, setEmails] = useState<string[]>(project.myEmails);
  const [newEmail, setNewEmail] = useState("");

  useEffect(() => {
    setName(project.name);
    setGithubOwner(project.githubOwner ?? "");
    setGithubRepo(project.githubRepo ?? "");
    setEmails(project.myEmails);
    setNewEmail("");
  }, [project]);

  const addEmail = () => {
    const trimmed = newEmail.trim().toLowerCase();
    if (!trimmed || emails.includes(trimmed)) return;
    setEmails((prev) => [...prev, trimmed]);
    setNewEmail("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar projeto</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label>Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Owner do GitHub</Label>
            <Input value={githubOwner} onChange={(e) => setGithubOwner(e.target.value)} placeholder="ex: samuelcolares" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Repo do GitHub</Label>
            <Input value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)} placeholder="ex: tonho-assistants" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Seus e-mails de commit</Label>
          <div className="flex flex-wrap gap-1.5">
            {emails.map((email) => (
              <Badge key={email} variant="bonnie" className="gap-1">
                {email}
                <button onClick={() => setEmails((prev) => prev.filter((e) => e !== email))}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addEmail())}
              placeholder="seu-email@exemplo.com"
            />
            <Button variant="secondary" size="sm" onClick={addEmail}>
              Adicionar
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              onSave({
                ...project,
                name: name.trim() || project.name,
                githubOwner: githubOwner.trim() || null,
                githubRepo: githubRepo.trim() || null,
                myEmails: emails,
              })
            }
          >
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const RANGE_PRESETS: { value: RangePreset; label: string }[] = [
  { value: "30", label: "30 dias" },
  { value: "45", label: "45 dias" },
  { value: "60", label: "60 dias" },
  { value: "90", label: "90 dias" },
  { value: "custom", label: "Custom" },
];

function RepoDetailView({
  project,
  onBack,
  onEdit,
}: {
  project: GitProject;
  onBack: () => void;
  onEdit: () => void;
}) {
  const { toast } = useToast();
  const [preset, setPreset] = useState<RangePreset>("30");
  const [customSince, setCustomSince] = useState(toDateInput(isoDaysAgo(30)));
  const [customUntil, setCustomUntil] = useState(toDateInput(new Date().toISOString()));
  const [stats, setStats] = useState<GitProjectStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenStatus, setTokenStatus] = useState<GithubTokenStatus>({ configured: false });
  const [compareMetric, setCompareMetric] = useState<CompareMetric>("commits");

  const range = useMemo(
    () => rangeFromPreset(preset, customSince, customUntil),
    [preset, customSince, customUntil]
  );

  useEffect(() => {
    getGithubTokenStatus().then(setTokenStatus);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getGitStats(project.id, range)
      .then((s) => !cancelled && setStats(s))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, range.since, range.until]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const s = await refreshGitStats(project.id, range);
      setStats(s);
    } catch (e) {
      toast({ variant: "danger", title: "Erro ao atualizar", description: String(e) });
    } finally {
      setRefreshing(false);
    }
  };

  const hasGithub = !!(project.githubOwner && project.githubRepo);
  const me = stats?.contributors.find((c) => c.isMe);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← Repos
          </Button>
          <h2 className="text-sm font-semibold text-ink">{project.name}</h2>
          <Button variant="ghost" size="icon" onClick={onEdit}>
            ✎
          </Button>
        </div>
        <div className="flex items-center gap-2">
          {stats?.fromCache && <span className="text-[11px] text-ink-faint">em cache</span>}
          <Button variant="secondary" size="sm" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? "Atualizando…" : "Atualizar"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPreset(p.value)}
            className={`rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors ${
              preset === p.value ? "bg-bonnie-subtle text-bonnie" : "text-ink-muted hover:bg-bg-200"
            }`}
          >
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <Input type="date" className="h-8 w-auto" value={customSince} onChange={(e) => setCustomSince(e.target.value)} />
            <span className="text-ink-faint">até</span>
            <Input type="date" className="h-8 w-auto" value={customUntil} onChange={(e) => setCustomUntil(e.target.value)} />
          </div>
        )}
      </div>

      {error && (
        <Card className="flex flex-col gap-2 border-danger/30">
          <p className="text-sm text-danger">{error}</p>
          <Button
            variant="secondary"
            size="sm"
            className="w-fit"
            onClick={() => {
              setError(null);
              setLoading(true);
              getGitStats(project.id, range)
                .then(setStats)
                .catch((e) => setError(String(e)))
                .finally(() => setLoading(false));
            }}
          >
            Tentar novamente
          </Button>
        </Card>
      )}

      {loading && !error && (
        <div className="grid grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="h-20 animate-pulse bg-bg-200" />
          ))}
        </div>
      )}

      {stats && !loading && !error && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
            <StatTile label="Commits (você)" value={me?.commitCount ?? 0} />
            <StatTile label="Linhas + (você)" value={me?.additions ?? 0} tone="success" />
            <StatTile label="Linhas - (você)" value={me?.deletions ?? 0} tone="danger" />
            {hasGithub && stats.github ? (
              <>
                <StatTile label="Total de PRs" value={stats.github.totalPrsAuthored} />
                <StatTile label="PRs abertas" value={stats.github.openPrsAuthored} tone="warning" />
              </>
            ) : hasGithub && tokenStatus.configured && stats.githubError ? (
              <Card className="col-span-2 flex flex-col gap-1 border-warning/30">
                <span className="text-[11px] uppercase tracking-wide text-ink-faint">GitHub</span>
                <p className="text-[12.5px] text-warning">{stats.githubError}</p>
              </Card>
            ) : (
              <GithubConnectionCard
                hasRemote={hasGithub}
                status={tokenStatus}
                onSave={async (token) => {
                  const s = await saveGithubToken(token);
                  setTokenStatus(s);
                  toast({ variant: "success", description: `Conectado como @${s.login}` });
                }}
                onClear={async () => {
                  await clearGithubToken();
                  setTokenStatus({ configured: false });
                }}
              />
            )}
          </div>

          <Card className="flex flex-col gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Atividade no período
            </h3>
            <CommitActivityChart data={stats.local.commitsByDay} />
          </Card>

          {stats.contributors.length > 0 && (
            <Card className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  Comparação com outros contribuintes
                </h3>
                <div className="flex gap-1">
                  {COMPARE_METRICS.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setCompareMetric(m.value)}
                      className={`rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                        compareMetric === m.value ? "bg-bonnie-subtle text-bonnie" : "text-ink-muted hover:bg-bg-200"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <ContributorCompareChart contributors={stats.contributors} metric={compareMetric} />
            </Card>
          )}

          {hasGithub && tokenStatus.configured && (
            <GithubConnectionCard
              hasRemote={hasGithub}
              status={tokenStatus}
              onSave={async (token) => {
                const s = await saveGithubToken(token);
                setTokenStatus(s);
              }}
              onClear={async () => {
                await clearGithubToken();
                setTokenStatus({ configured: false });
              }}
            />
          )}

          {!hasGithub && (
            <p className="text-[12px] text-ink-faint">
              Este projeto não tem um remote do GitHub configurado — apenas estatísticas locais
              estão disponíveis. Edite o projeto pra adicionar owner/repo manualmente.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "danger" | "warning";
}) {
  const toneClass = tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-ink";
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</span>
      <span className={`text-2xl font-bold ${toneClass}`}>{value}</span>
    </Card>
  );
}

function GithubConnectionCard({
  hasRemote,
  status,
  onSave,
  onClear,
}: {
  hasRemote: boolean;
  status: GithubTokenStatus;
  onSave: (token: string) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    setBusy(true);
    try {
      await onSave(token.trim());
      setToken("");
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível conectar", description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-ink-muted" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">GitHub</h3>
      </div>
      {status.configured ? (
        <>
          <p className="text-sm text-success">Conectado como @{status.login}</p>
          <Button variant="secondary" size="sm" className="w-fit" onClick={onClear}>
            Desconectar
          </Button>
        </>
      ) : (
        <>
          <p className="text-[12px] text-ink-muted">
            {hasRemote
              ? "Conecte um token pra ver PRs, issues e comparação com outros contribuintes."
              : "Sem remote detectado — configure owner/repo na edição do projeto primeiro."}
          </p>
          <div className="flex gap-2">
            <Input
              type="password"
              placeholder="ghp_..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <Button size="sm" onClick={handleSave} disabled={busy || !token.trim()}>
              {busy ? "Validando…" : "Conectar"}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

function CommitActivityChart({ data }: { data: { date: string; count: number }[] }) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-[12.5px] text-ink-faint">Sem atividade no período.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#23273a" vertical={false} />
        <XAxis dataKey="date" tick={{ fill: "#9298b3", fontSize: 11 }} axisLine={{ stroke: "#23273a" }} tickLine={false} />
        <YAxis tick={{ fill: "#9298b3", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: "#12141d", border: "1px solid #23273a", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#eef0f7" }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} formatter={() => "Commits"} />
        <Bar dataKey="count" name="Commits" fill="#3b9eff" radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

type CompareMetric = "commits" | "additions" | "deletions";

const COMPARE_METRICS: { value: CompareMetric; label: string }[] = [
  { value: "commits", label: "Commits" },
  { value: "additions", label: "Linhas +" },
  { value: "deletions", label: "Linhas -" },
];

const COMPARE_METRIC_KEY: Record<CompareMetric, "commitCount" | "additions" | "deletions"> = {
  commits: "commitCount",
  additions: "additions",
  deletions: "deletions",
};

function ContributorCompareChart({
  contributors,
  metric,
}: {
  contributors: { login: string; commitCount: number; additions: number; deletions: number; isMe: boolean }[];
  metric: CompareMetric;
}) {
  const dataKey = COMPARE_METRIC_KEY[metric];
  const data = [...contributors].sort((a, b) => b[dataKey] - a[dataKey]).slice(0, 10);
  const barColor = metric === "deletions" ? "#f87171" : metric === "additions" ? "#34d399" : "#3b9eff";

  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#23273a" horizontal={false} />
        <XAxis type="number" tick={{ fill: "#9298b3", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="login"
          tick={{ fill: "#eef0f7", fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={100}
        />
        <Tooltip
          contentStyle={{ background: "#12141d", border: "1px solid #23273a", borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: "#eef0f7" }}
        />
        <Bar dataKey={dataKey} name={COMPARE_METRICS.find((m) => m.value === metric)!.label} radius={[0, 4, 4, 0]} maxBarSize={20}>
          {data.map((d) => (
            <Cell key={d.login} fill={d.isMe ? "#1eb4c8" : barColor + "55"} stroke={d.isMe ? undefined : barColor} strokeWidth={d.isMe ? 0 : 1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
