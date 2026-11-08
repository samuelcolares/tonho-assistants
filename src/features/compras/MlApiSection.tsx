import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, KeyRound } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { comprasMlClearCredentials, comprasMlSaveCredentials, comprasMlStatus } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { MlStatus } from "@/types";
import { errorMessage } from "./format";

const DEVCENTER = "https://developers.mercadolivre.com.br/devcenter";

/** Credenciais do app do Mercado Livre (API oficial). Ficam no cofre do Windows, nunca em arquivo. */
export function MlApiSection({ open }: { open: boolean }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<MlStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSecret("");
    comprasMlStatus()
      .then((s) => {
        setStatus(s);
        setClientId(s.clientId ?? "");
      })
      .catch(() => setStatus({ configured: false, clientId: null }));
  }, [open]);

  const save = async () => {
    setBusy(true);
    try {
      const s = await comprasMlSaveCredentials(clientId, secret);
      setStatus(s);
      setSecret("");
      toast({ title: "Mercado Livre conectado", description: "As ofertas do ML serão consultadas pela API oficial." });
    } catch (e) {
      toast({ variant: "danger", title: "Credenciais recusadas", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      setStatus(await comprasMlClearCredentials());
      setClientId("");
    } catch (e) {
      toast({ variant: "danger", title: "Falha ao desconectar", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-ink-muted" />
        <strong className="text-[13px] text-ink">Mercado Livre (API oficial)</strong>
        {status?.configured && (
          <span className="flex items-center gap-1 text-[12px] font-medium text-compras">
            <CheckCircle2 className="h-3.5 w-3.5" /> conectado
          </span>
        )}
      </div>
      <p className="text-[12px] text-ink-faint">
        O site do ML bloqueia consultas automáticas. Crie um app grátis no DevCenter do Mercado Livre e cole aqui o App ID e a
        chave secreta. Use links de catálogo (com <code>/p/MLB…</code>). As credenciais ficam no cofre do Windows.
      </p>
      <Button variant="ghost" size="sm" className="w-fit px-0 text-[12px]" onClick={() => openUrl(DEVCENTER)}>
        <ExternalLink className="h-3.5 w-3.5" /> Abrir DevCenter do Mercado Livre
      </Button>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="w-44" placeholder="App ID" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={busy} />
        <Input
          className="w-56"
          type="password"
          placeholder={status?.configured ? "Chave secreta (salva)" : "Chave secreta"}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          disabled={busy}
        />
        <Button size="sm" onClick={save} disabled={busy || !clientId.trim() || !secret.trim()}>
          {busy ? "Validando…" : status?.configured ? "Atualizar" : "Conectar"}
        </Button>
        {status?.configured && (
          <Button size="sm" variant="ghost" onClick={clear} disabled={busy}>
            Desconectar
          </Button>
        )}
      </div>
    </div>
  );
}
