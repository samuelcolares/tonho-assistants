import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { comprasMlClearCredentials, comprasMlSaveCredentials, comprasMlStatus } from "@/api";
import { useToast } from "@/hooks/use-toast";
import type { MlStatus } from "@/types";
import { errorMessage } from "./format";
import { CmButton, CmInput } from "./ui";

const DEVCENTER = "https://developers.mercadolivre.com.br/devcenter";

/** Credenciais do app do Mercado Livre (API oficial). Ficam no cofre do Windows, nunca em arquivo. */
export function MlApiSection() {
  const { toast } = useToast();
  const [status, setStatus] = useState<MlStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    comprasMlStatus()
      .then((s) => {
        setStatus(s);
        setClientId(s.clientId ?? "");
      })
      .catch(() => setStatus({ configured: false, clientId: null }));
  }, []);

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
    <div className="mt-6 flex flex-col gap-3 border-t border-cm-hairline pt-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[14px] font-bold text-cm-ink">Mercado Livre (API oficial)</p>
        {status?.configured && (
          <span className="inline-flex items-center gap-1.5 border border-cm-accent px-2 py-0.5 text-[11px] font-bold uppercase tracking-[1.5px] text-cm-accent">
            <CheckCircle2 className="h-3.5 w-3.5" /> Conectado
          </span>
        )}
      </div>
      <p className="max-w-xl text-[13px] font-light text-cm-muted">
        O site do Mercado Livre bloqueia consultas automáticas. Crie um app grátis no DevCenter e cole aqui o App ID e a chave
        secreta. Use links de catálogo (com <code className="text-cm-body">/p/MLB…</code>). Os dados ficam no cofre do Windows.
      </p>
      <CmButton variant="ghost" size="sm" className="w-fit px-0" onClick={() => openUrl(DEVCENTER)}>
        <ExternalLink className="h-3.5 w-3.5" /> Abrir DevCenter do Mercado Livre
      </CmButton>
      <div className="flex flex-wrap items-center gap-3">
        <CmInput
          aria-label="App ID"
          className="w-48"
          placeholder="App ID"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          disabled={busy}
        />
        <CmInput
          aria-label="Chave secreta"
          className="w-60"
          type="password"
          placeholder={status?.configured ? "Chave secreta (salva)" : "Chave secreta"}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          disabled={busy}
        />
        <CmButton onClick={save} disabled={busy || !clientId.trim() || !secret.trim()}>
          {busy ? "Validando…" : status?.configured ? "Atualizar" : "Conectar"}
        </CmButton>
        {status?.configured && (
          <CmButton variant="danger-ghost" onClick={clear} disabled={busy}>
            Desconectar
          </CmButton>
        )}
      </div>
    </div>
  );
}
