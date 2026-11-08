import { useEffect, useState } from "react";
import { FolderOpen, Link2 } from "lucide-react";
import { comprasSaveImageFromUrl, comprasSetImageFromFile, pickImageFile } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorMessage } from "./format";
import { Field } from "./shared";

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
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Trocar imagem</DialogTitle>
          <DialogDescription>JPEG, PNG ou WebP, até 5 MB.</DialogDescription>
        </DialogHeader>
        <Button variant="secondary" onClick={fromFile} disabled={busy}>
          <FolderOpen className="h-4 w-4" /> Escolher arquivo…
        </Button>
        <Field label="Ou cole o endereço da imagem">
          <div className="flex gap-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/foto.jpg" />
            <Button onClick={() => run(() => comprasSaveImageFromUrl(itemId, url.trim()))} disabled={busy || !url.trim()}>
              <Link2 className="h-4 w-4" /> Baixar
            </Button>
          </div>
        </Field>
      </DialogContent>
    </Dialog>
  );
}
