import { useEffect, useState } from "react";
import { FolderOpen, Link2 } from "lucide-react";
import { comprasSaveImageFromUrl, comprasSetImageFromFile, pickImageFile } from "@/api";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "./format";
import { CmButton, CmDialog, CmDialogContent, CmDialogDescription, CmDialogTitle, CmField, CmInput } from "./ui";

interface ImageDialogProps {
  open: boolean;
  itemId: string;
  onClose: () => void;
  onDone: () => void;
}

/** Replaces an item's image from a local file or an image URL. */
export function ImageDialog({ open, itemId, onClose, onDone }: ImageDialogProps) {
  const { toast } = useToast();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setUrl("");
  }, [open]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast({ variant: "success", title: "Imagem atualizada" });
      onDone();
      onClose();
    } catch (e) {
      toast({ variant: "danger", title: "Não foi possível atualizar a imagem", description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const fromFile = async () => {
    const path = await pickImageFile();
    if (path) await run(() => comprasSetImageFromFile(itemId, path));
  };

  return (
    <CmDialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <CmDialogContent className="max-w-md">
        <div className="flex flex-col gap-2 pr-8">
          <CmDialogTitle>Trocar imagem</CmDialogTitle>
          <CmDialogDescription>JPEG, PNG ou WebP, até 5 MB.</CmDialogDescription>
        </div>
        <CmButton onClick={fromFile} disabled={busy}>
          <FolderOpen className="h-4 w-4" /> Escolher arquivo…
        </CmButton>
        <CmField label="Ou cole o endereço da imagem" htmlFor="image-url">
          <div className="flex gap-2">
            <CmInput id="image-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/foto.jpg" />
            <CmButton variant="strong" className="h-12" onClick={() => run(() => comprasSaveImageFromUrl(itemId, url.trim()))} disabled={busy || !url.trim()}>
              <Link2 className="h-4 w-4" /> Baixar
            </CmButton>
          </div>
        </CmField>
      </CmDialogContent>
    </CmDialog>
  );
}
