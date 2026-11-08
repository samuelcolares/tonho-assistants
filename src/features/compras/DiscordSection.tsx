import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { comprasDiscordClear, comprasDiscordSave, comprasDiscordStatus, comprasDiscordTest } from "@/api";
import { useToast } from "@/hooks/use-toast";
import type { ComprasSettings, DiscordStatus } from "@/types";
import { errorMessage } from "./format";
import { SettingRow } from "./SettingsParts";
import { CmButton, CmInput, CmSwitch } from "./ui";

type Busy = "save" | "test" | "clear" | null;

/**
 * Discord como segundo canal de avisos. A URL do webhook é um segredo: vai direto para o cofre do Windows
 * (o campo é de senha e é esvaziado depois de conectar) e nunca volta para esta tela, só um trecho para reconhecer.
 */
export function DiscordSection({
  settings: s,
  update,
  masterOff,
}: {
  settings: ComprasSettings;
  update: (patch: Partial<ComprasSettings>) => void;
  /** "Avisos de preço" desligado: nada é enviado, em canal nenhum. */
  masterOff: boolean;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<Busy>(null);

  useEffect(() => {
    comprasDiscordStatus()
      .then(setStatus)
      .catch(() => setStatus({ configured: false, webhookHint: null }));
  }, []);

  const configured = status?.configured ?? false;
  const off = !configured || masterOff;

  const connect = async () => {
    setBusy("save");
    try {
      const st = await comprasDiscordSave(url);
      setStatus(st);
      setUrl("");
      if (!s.discordEnabled) update({ discordEnabled: true });
      toast({ variant: "success", title: "Discord conectado", description: "Mandamos uma mensagem de teste para o canal." });
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível conectar o Discord", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy("test");
    try {
      await comprasDiscordTest();
      toast({ variant: "success", title: "Teste enviado ao Discord", description: "Confira o canal." });
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível enviar o teste", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("clear");
    try {
      setStatus(await comprasDiscordClear());
      update({ discordEnabled: false });
    } catch (e) {
      toast({ variant: "danger", title: "Falha ao desconectar", description: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-3 border-t border-cm-hairline pt-6" role="group" aria-labelledby="sec-discord">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id="sec-discord" className="text-[14px] font-bold uppercase tracking-[1.5px] text-cm-ink">
          Discord
        </h3>
        {configured && (
          <span className="inline-flex items-center gap-1.5 border border-cm-accent px-2 py-0.5 text-[11px] font-bold uppercase tracking-[1.5px] text-cm-accent">
            <CheckCircle2 className="h-3.5 w-3.5" /> Conectado
          </span>
        )}
      </div>
      <p className="max-w-xl text-[13px] font-light text-cm-body">
        Receba os avisos num canal do Discord — útil para o celular e para a sua esposa.
      </p>
      <p className="max-w-xl text-[13px] font-light text-cm-muted">
        Como pegar o endereço: no Discord, abra{" "}
        <strong className="font-bold text-cm-body">Servidor &gt; Editar canal &gt; Integrações &gt; Webhooks &gt; Novo webhook &gt; Copiar URL</strong>. O
        endereço fica guardado no cofre do Windows, nunca em arquivo.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <CmInput
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label="Endereço do webhook do Discord"
          className="w-full max-w-md"
          placeholder={configured ? "Cole outro endereço para trocar" : "https://discord.com/api/webhooks/…"}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && url.trim() && busy == null && void connect()}
          disabled={busy != null}
        />
        <CmButton onClick={connect} disabled={busy != null || !url.trim()}>
          {busy === "save" ? "Validando…" : configured ? "Trocar" : "Conectar"}
        </CmButton>
      </div>

      {configured && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] font-light text-cm-body">
            Conectado <span className="tabular-nums text-cm-muted">({status?.webhookHint})</span>
          </span>
          <CmButton size="sm" onClick={test} disabled={busy != null}>
            {busy === "test" ? "Enviando…" : "Enviar teste"}
          </CmButton>
          <CmButton size="sm" variant="danger-ghost" onClick={disconnect} disabled={busy != null}>
            Desconectar
          </CmButton>
        </div>
      )}

      <div className="mt-2 flex flex-col">
        <SettingRow
          label="Enviar avisos ao Discord"
          hint={
            !configured
              ? "Conecte um webhook acima para ligar."
              : masterOff
                ? "Os avisos de preço estão desligados mais acima."
                : "Os mesmos avisos do Windows, com as mesmas regras de intervalo."
          }
          disabled={off}
        >
          <CmSwitch aria-label="Enviar avisos ao Discord" checked={s.discordEnabled} disabled={off} onChange={(v) => update({ discordEnabled: v })} />
        </SettingRow>
        <SettingRow label="Também novo menor preço" hint="Avisa no Discord quando um item bate o menor valor já visto." disabled={off || !s.discordEnabled}>
          <CmSwitch
            aria-label="Também novo menor preço no Discord"
            checked={s.discordNewLow}
            disabled={off || !s.discordEnabled}
            onChange={(v) => update({ discordNewLow: v })}
          />
        </SettingRow>
        <SettingRow
          label="Respeitar horário silencioso"
          hint="Ligado: o Discord também espera o fim do horário silencioso. Desligado: manda na hora, mesmo de madrugada."
          disabled={off || !s.discordEnabled}
        >
          <CmSwitch
            aria-label="Respeitar horário silencioso no Discord"
            checked={s.discordRespectQuietHours}
            disabled={off || !s.discordEnabled}
            onChange={(v) => update({ discordRespectQuietHours: v })}
          />
        </SettingRow>
        <SettingRow label="Mencionar @here" hint="Chama quem estiver online no canal a cada aviso. Só vale para @here." disabled={off || !s.discordEnabled}>
          <CmSwitch
            aria-label="Mencionar @here no Discord"
            checked={s.discordMention === "@here"}
            disabled={off || !s.discordEnabled}
            onChange={(v) => update({ discordMention: v ? "@here" : "" })}
          />
        </SettingRow>
      </div>
    </div>
  );
}
